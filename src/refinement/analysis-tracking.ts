// Tarea de seguimiento "Análisis · <nombre> · fecha" (parte 10B-1): como la Planificación, pero sin historia donde
// caer por defecto. Va a la gestión del proyecto o adonde el dev elija; el registro queda en el análisis, nunca en una historia
import { IssueNotFoundError } from '../services/jira';
import { analysisTrackingSummary, readAnalysis, updateAnalysis } from './analysis';
import { type CreateJira, resolveManagementTarget } from './create';
import { type ExecutionJira, finishTask } from './execution';
import { parseFinalEstimate } from './pert';
import { createTrackingIssue, startInJira } from './planning';
import { parseDueDateInput, todayIso } from './schedule';
import { isValidIssueKey } from './state';
import type { StoryStore } from './story-store';
import type { PlanningInput, PlanningOutcome, TransitionOptions, TransitionOutcome } from './tasks-types';
import type { TransitionMemory } from './transition-memory';

const ANALYSIS_DESCRIPTION = 'Análisis sin historia registrado con JM-SHELL.';
const NO_DESTINATION = 'No hay épica o historia de gestión: elige dónde registrar el análisis.';

export const analysisTrackingFailure = (reason: string): string => `No pude crear la tarea de análisis: ${reason}`;

export interface AnalysisTrackingDeps {
  jira: CreateJira & ExecutionJira;
  store: StoryStore;
  assigneeId: string;
  transitionMemory?: TransitionMemory;
  // Épica o historia de gestión del proyecto del análisis; null si no hay
  management: string | null;
  now?: () => Date;
}

// Sin destino utilizable no se crea nada en Jira: se devuelve askWhere para que el dev elija otro
const askWhere = (message: string): PlanningOutcome => ({ ok: false, message, askWhere: true });

export async function createAnalysisTracking(
  deps: AnalysisTrackingDeps,
  id: string,
  input: PlanningInput,
  whereKey: string | null,
): Promise<PlanningOutcome> {
  try {
    const state = await readAnalysis(deps.store, id);
    if (!state) return { ok: false, message: analysisTrackingFailure(`el análisis ${id} no existe.`) };
    const now = deps.now?.() ?? new Date();
    const today = todayIso(now);
    const estimateSeconds = parseFinalEstimate(input.estimate.trim());
    const dueDate = parseDueDateInput(input.dueDate.trim() || today, today);
    const destination = whereKey ?? deps.management;
    if (!destination) return askWhere(NO_DESTINATION);
    const resolved = await resolveManagementTarget(deps.jira, destination);
    if (!resolved.ok) {
      const managed = whereKey === null;
      return askWhere(managed ? `La de gestión ${destination} no sirve: ${resolved.message}` : resolved.message);
    }
    const key = await createTrackingIssue(deps, {
      target: resolved.target,
      summary: analysisTrackingSummary(state.name, today),
      description: ANALYSIS_DESCRIPTION,
      estimateSeconds,
      dueDate,
    });
    // Una clave anómala se descartaría al releer el estado: mejor avisar ahora que perder el registro en silencio
    if (!isValidIssueKey(key)) {
      return { ok: false, message: analysisTrackingFailure(`Jira devolvió una clave inesperada (${key}).`) };
    }
    // Ya existe en Jira: desde aquí nada puede devolver un fallo sin su clave (se volvería a crear otra al entrar)
    return await recordTracking(deps, id, key, estimateSeconds, now);
  } catch (err: unknown) {
    const message = err instanceof IssueNotFoundError ? 'no encontré el destino en Jira.' : (err as Error).message;
    return { ok: false, message: analysisTrackingFailure(message) };
  }
}

async function recordTracking(
  deps: AnalysisTrackingDeps,
  id: string,
  key: string,
  estimateSeconds: number,
  now: Date,
): Promise<PlanningOutcome> {
  const started = await startInJira(deps, key);
  try {
    await updateAnalysis(deps.store, id, (state) => {
      state.trackingTasks = [...state.trackingTasks, { issueKey: key, estimateSeconds, createdAt: now.toISOString() }];
      state.taskRuns[key] = {
        issueKey: key,
        claudeSessionId: null,
        startedAt: now.toISOString(),
        finishedAt: null,
        activeMs: 0,
        status: 'started',
      };
    });
    return { ok: true, issueKey: key, started };
  } catch (err: unknown) {
    return {
      ok: false,
      message: `Creé ${key} en Jira, pero no pude registrarla en jm (${(err as Error).message}); finalízala desde Jira.`,
    };
  }
}

export interface AnalysisFinishContext {
  jira: ExecutionJira;
  store: StoryStore;
  transitionMemory?: TransitionMemory;
  now?: () => Date;
}

// Pasa la tarea a Finalizada en Jira y recién entonces marca el cierre en el análisis (sin cierre pendiente que reintentar)
export async function finishAnalysisTask(
  ctx: AnalysisFinishContext,
  id: string,
  issueKey: string,
  options: TransitionOptions = {},
): Promise<TransitionOutcome> {
  const outcome = await finishTask(
    { jira: ctx.jira, store: null, transitionMemory: ctx.transitionMemory },
    null,
    issueKey,
    options,
  );
  if (outcome.kind !== 'ok') return outcome;
  const finishedAt = (ctx.now?.() ?? new Date()).toISOString();
  try {
    await updateAnalysis(ctx.store, id, (state) => {
      const run = state.taskRuns[issueKey];
      if (!run) {
        state.taskRuns[issueKey] = {
          issueKey,
          claudeSessionId: null,
          startedAt: null,
          finishedAt,
          activeMs: 0,
          status: 'done',
          finishedDirect: true,
        };
        return;
      }
      run.finishedAt = run.finishedAt ?? finishedAt;
      run.status = 'done';
    });
  } catch (err: unknown) {
    return {
      kind: 'failed',
      message: `Quedó Finalizada en Jira, pero no pude registrarlo en jm (${(err as Error).message}).`,
    };
  }
  return { kind: 'ok', storyKey: id };
}
