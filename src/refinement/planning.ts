// Tarea de Planificación al entrar a una historia: el análisis y la replanificación también quedan registrados.
// Todo sin IA: se crea en Jira bajo la historia, queda iniciada y su tiempo se mide de inicio a fin como las demás
import { IssueNotFoundError } from '../services/jira';
import { markdownToAdf } from '../utils/adf';
import { formatSeconds } from '../utils/time';
import { elapsedMsOf, EMPTY_PLANNING } from './calibration';
import { type CreateJira, resolveParent } from './create';
import { type ExecutionJira, startTask } from './execution';
import { estimateForJira, parseFinalEstimate } from './pert';
import { projectKeyOfStory } from './repos';
import { parseDueDateInput, TODAY_WORD, todayIso } from './schedule';
import { assertKey, ensureStory, isValidIssueKey, readState, updateState } from './state';
import type { StoryStore } from './story-store';
import type { AskReason } from './review-types';
import type { PlanningGroup, PlanningInput, PlanningOutcome, PlanningSuggestion } from './tasks-types';
import type { TransitionMemory } from './transition-memory';
import type { StoryState } from './types';

export const DEFAULT_PLANNING_SECONDS = 3600;
const MS_PER_SECOND = 1000;
const PLANNING_DESCRIPTION = 'Análisis y planificación de la historia, registrada con JM-SHELL.';

export const planningSummary = (date: string): string => `Planificación · ${date}`;
export const planningFailure = (reason: string): string => `No pude crear la Planificación: ${reason}`;

const PARENT_PROBLEMS: Record<AskReason, string> = {
  epic: 'la clave es una épica',
  subtask: 'la clave es una subtarea',
  done: 'la historia ya está finalizada en Jira',
  'not-found': 'no encontré la historia en Jira',
};

// La Planificación abierta más reciente de la historia (creada y sin finalizar)
export function openPlanningOf(state: StoryState | null): string | null {
  const open = (state?.planningTasks ?? []).filter((task) => state?.taskRuns[task.issueKey]?.status !== 'done');
  return open.length > 0 ? open[open.length - 1].issueKey : null;
}

// Planificaciones finalizadas tras iniciarlas: estimado y real de inicio a fin
export function planningGroupOf(states: StoryState[]): PlanningGroup {
  const group: PlanningGroup = { ...EMPTY_PLANNING };
  for (const state of states) {
    for (const task of state.planningTasks ?? []) {
      const run = state.taskRuns[task.issueKey];
      if (!run || run.status !== 'done' || !run.finishedAt || run.finishedDirect) continue;
      const elapsedSeconds = Math.round(elapsedMsOf(run) / MS_PER_SECOND);
      if (elapsedSeconds <= 0) continue;
      group.count += 1;
      group.estimateSeconds += task.estimateSeconds;
      group.elapsedSeconds += elapsedSeconds;
    }
  }
  return group;
}

// 1h al principio; con Planificaciones medidas, el promedio de lo que de verdad tomaron (redondeado como para Jira)
export function suggestPlanning(group: PlanningGroup): PlanningSuggestion {
  const seconds = group.count > 0 ? estimateForJira(group.elapsedSeconds / group.count) : DEFAULT_PLANNING_SECONDS;
  return { estimate: formatSeconds(seconds), dueDate: TODAY_WORD, measured: group.count };
}

export interface PlanningDeps {
  jira: CreateJira & ExecutionJira;
  store: StoryStore;
  assigneeId: string;
  transitionMemory?: TransitionMemory;
  now?: () => Date;
}

// Antes del chat la historia puede no existir aún en jm: se crea su estado con lo mínimo (el chat completa el resto)
async function ensureState(deps: PlanningDeps, storyKey: string): Promise<void> {
  if (await readState(deps.store, storyKey)) return;
  const issue = await deps.jira.getIssue(storyKey);
  await ensureStory(deps.store, storyKey, issue.fields.summary, issue.fields.parent?.key ?? null);
}

export async function createPlanning(
  deps: PlanningDeps,
  storyKey: string,
  input: PlanningInput,
): Promise<PlanningOutcome> {
  try {
    assertKey(storyKey);
    const now = deps.now?.() ?? new Date();
    const today = todayIso(now);
    const estimateSeconds = parseFinalEstimate(input.estimate.trim());
    const dueDate = parseDueDateInput(input.dueDate.trim() || today, today);
    const parent = await resolveParent(deps.jira, storyKey);
    if (parent.kind !== 'ready') {
      return { ok: false, message: planningFailure(`${PARENT_PROBLEMS[parent.reason]}.`) };
    }
    await ensureState(deps, storyKey);
    const { target } = parent;
    const { key } = await deps.jira.createIssue({
      projectKey: projectKeyOfStory(target.parentKey),
      summary: planningSummary(today),
      issueTypeName: target.issueTypeName,
      issueTypeId: target.issueTypeId,
      assigneeId: deps.assigneeId,
      estimateSeconds,
      dueDate,
      parentKey: target.parentKey,
      description: markdownToAdf(PLANNING_DESCRIPTION),
    });
    // Una clave anómala se descartaría al releer el estado: mejor avisar ahora que perder el registro en silencio
    if (!isValidIssueKey(key)) return { ok: false, message: planningFailure(`Jira devolvió una clave inesperada (${key}).`) };
    // Ya existe en Jira: desde aquí nada puede devolver un fallo sin su clave (se volvería a crear otra al entrar)
    return await recordPlanning(deps, storyKey, key, estimateSeconds, now);
  } catch (err: unknown) {
    const message = err instanceof IssueNotFoundError ? `No encontré ${storyKey} en Jira.` : (err as Error).message;
    return { ok: false, message: planningFailure(message) };
  }
}

async function recordPlanning(
  deps: PlanningDeps,
  storyKey: string,
  key: string,
  estimateSeconds: number,
  now: Date,
): Promise<PlanningOutcome> {
  // Sin almacén: solo se mueve en Jira; el registro se hace aquí para no cambiar la fase de la historia.
  // Si la transición falla, la tarea queda creada y su tiempo corre igual en jm
  const transition = await startTask(
    { jira: deps.jira, store: null, transitionMemory: deps.transitionMemory },
    null,
    key,
  ).catch(() => null);
  try {
    await updateState(deps.store, storyKey, (state) => {
      state.planningTasks = [
        ...(state.planningTasks ?? []),
        { issueKey: key, estimateSeconds, createdAt: now.toISOString() },
      ];
      state.taskRuns[key] = {
        issueKey: key,
        claudeSessionId: null,
        startedAt: now.toISOString(),
        finishedAt: null,
        activeMs: 0,
        status: 'started',
      };
    });
    return { ok: true, issueKey: key, started: transition?.kind === 'ok' };
  } catch (err: unknown) {
    return {
      ok: false,
      message: `Creé ${key} en Jira, pero no pude registrarla en jm (${(err as Error).message}); finalízala desde Jira.`,
    };
  }
}
