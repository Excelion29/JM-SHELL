// Vincular un análisis a Jira (parte 10C): épica del análisis y una tarea (épica) o subtarea (historia) por punto
import { markdownToAdf } from '../utils/adf';
import { readAnalysis, updateAnalysis } from './analysis';
import { POINT_TEXT_MAX_CHARS, POINT_TITLE_MAX_CHARS } from './analysis-point-context';
import { pointStatusOf } from './analysis-point-runs';
import { type AnalysisPoint, loadPoints, pointExpectedSeconds } from './analysis-points';
import type { LinkPointResult, LinkTargetOutcome } from './analysis-types';
import type { CreationTarget, TargetResult } from './review-types';
import { type CreateJira, oneLine, resolveTarget } from './create';
import { type ExecutionJira, finishTask, returnTo, startTask } from './execution';
import { estimateForJira } from './pert';
import { startInJira } from './planning';
import { projectKeyOfStory } from './repos';
import { recommendSchedule, todayIso } from './schedule';
import { isValidIssueKey } from './state';
import type { StoryStore } from './story-store';
import type { TransitionOutcome } from './tasks-types';
import { stripControlChars, stripTerminalControls } from './text';
import type { TransitionMemory } from './transition-memory';
import type { TaskRun } from './types';

export interface LinkDeps {
  jira: CreateJira & ExecutionJira;
  store: StoryStore;
  assigneeId: string;
  transitionMemory?: TransitionMemory;
  // Hoy (AAAA-MM-DD) para recomendar fechas; inyectable en pruebas
  today?: string;
}

type LinkedState = Pick<LinkDeps, 'jira' | 'transitionMemory'>;

const clip = (text: string): string => stripTerminalControls(text).trim().slice(0, POINT_TEXT_MAX_CHARS);

// El análisis y la propuesta vienen de puntos.json (lo escribe Claude): sin secuencias de terminal y acotados
export function pointDescription(point: AnalysisPoint): string {
  return [`## Análisis\n\n${clip(point.analysis)}`, `## Propuesta\n\n${clip(point.proposal)}`].join('\n\n');
}

export const pointSummary = (point: AnalysisPoint): string =>
  oneLine(stripControlChars(point.title)).slice(0, POINT_TITLE_MAX_CHARS);

// Destino válido: de este proyecto y no una subtarea; con mustBeEpic, solo una épica
async function resolveCreation(
  jira: CreateJira,
  projectKey: string,
  key: string,
  mustBeEpic: boolean,
): Promise<TargetResult> {
  const resolved = await resolveTarget(jira, key);
  if (!resolved.ok) return resolved;
  const { target } = resolved;
  if (projectKey && projectKeyOfStory(target.parentKey) !== projectKey) {
    return { ok: false, message: `${key} no es del proyecto ${projectKey}.` };
  }
  if (mustBeEpic && target.childKind !== 'standard') return { ok: false, message: `${key} no es una épica.` };
  return resolved;
}

export async function resolveLinkTarget(
  jira: CreateJira,
  projectKey: string,
  key: string,
  mustBeEpic: boolean,
): Promise<LinkTargetOutcome> {
  const resolved = await resolveCreation(jira, projectKey, key, mustBeEpic);
  if (!resolved.ok) return resolved;
  const { target } = resolved;
  return { ok: true, target: { key: target.parentKey, summary: target.parentSummary, childKind: target.childKind } };
}

export async function setAnalysisEpic(store: StoryStore, id: string, epicKey: string | null): Promise<void> {
  if (epicKey !== null && !isValidIssueKey(epicKey)) throw new Error(`Clave de épica inválida: "${epicKey}".`);
  await updateAnalysis(store, id, (state) => {
    const points = state.link?.points ?? {};
    if (epicKey || Object.keys(points).length > 0) state.link = { epicKey, points };
    else delete state.link;
  });
}

const failure = (pointId: string, message: string): LinkPointResult => ({ pointId, ok: false, message });

function noticeOf(outcome: TransitionOutcome, key: string): string | null {
  if (outcome.kind === 'ok') return null;
  if (outcome.kind === 'failed') return `No pude mover ${key} en Jira: ${outcome.message}`;
  return `Jira no tiene una transición conocida para ${key}; muévela a mano.`;
}

// Jira quedó como el punto en jm: devuelve el aviso si no se pudo
async function syncStatus(deps: LinkedState, run: TaskRun | undefined, key: string): Promise<string | null> {
  const status = pointStatusOf(run);
  if (status === 'started') {
    return (await startInJira(deps, key)) ? null : `${key} creada, pero no pude pasarla a En curso en Jira.`;
  }
  if (status === 'done') return noticeOf(await finishLinked(deps, key), key);
  return null;
}

const ctxOf = (deps: LinkedState) => ({ jira: deps.jira, store: null, transitionMemory: deps.transitionMemory });

export const startLinked = async (deps: LinkedState, key: string): Promise<string | null> =>
  noticeOf(await startTask(ctxOf(deps), null, key, { reopen: true }), key);

const finishLinked = (deps: LinkedState, key: string): Promise<TransitionOutcome> =>
  finishTask(ctxOf(deps), null, key);

export const finishLinkedNotice = async (deps: LinkedState, key: string): Promise<string | null> =>
  noticeOf(await finishLinked(deps, key), key);

export async function returnLinked(jira: ExecutionJira, key: string, transitionName: string): Promise<string | null> {
  try {
    await returnTo(jira, key, transitionName);
    return null;
  } catch (err: unknown) {
    return `No pude mover ${key} en Jira: ${(err as Error).message}`;
  }
}

export async function linkedIssueOf(store: StoryStore, id: string, pointId: string): Promise<string | null> {
  return (await readAnalysis(store, id))?.link?.points[pointId]?.issueKey ?? null;
}

interface CreateOne {
  deps: LinkDeps;
  id: string;
  point: AnalysisPoint;
  parent: CreationTarget;
  dueDate: string;
  run: TaskRun | undefined;
}

// Se anota en estado.json apenas se crea: un reintento nunca duplica lo ya creado
async function createOne({ deps, id, point, parent, dueDate, run }: CreateOne): Promise<LinkPointResult> {
  let key: string;
  try {
    const expected = pointExpectedSeconds(point);
    const created = await deps.jira.createIssue({
      projectKey: projectKeyOfStory(parent.parentKey),
      summary: pointSummary(point),
      issueTypeName: parent.issueTypeName,
      issueTypeId: parent.issueTypeId,
      assigneeId: deps.assigneeId,
      ...(expected === null ? {} : { estimateSeconds: estimateForJira(expected) }),
      dueDate,
      parentKey: parent.parentKey,
      description: markdownToAdf(pointDescription(point)),
    });
    key = created.key;
    if (!isValidIssueKey(key)) return failure(point.id, `Jira devolvió una clave inesperada (${key}).`);
  } catch (err: unknown) {
    return failure(point.id, (err as Error).message);
  }
  try {
    await updateAnalysis(deps.store, id, (state) => {
      const link = state.link ?? { epicKey: null, points: {} };
      link.points[point.id] = { issueKey: key, parentKey: parent.parentKey };
      state.link = link;
    });
  } catch (err: unknown) {
    const message = `Creé ${key}, pero no pude registrarlo en jm: ${(err as Error).message}`;
    return { pointId: point.id, ok: true, issueKey: key, message };
  }
  const message = await syncStatus(deps, run, key).catch((err: unknown) => (err as Error).message);
  return { pointId: point.id, ok: true, issueKey: key, ...(message ? { message } : {}) };
}

// targets: punto -> clave del destino. Solo crea los puntos aún sin tarea; el orden es el de puntos.json
export async function createLinkedPoints(
  deps: LinkDeps,
  id: string,
  targets: Record<string, string>,
): Promise<LinkPointResult[]> {
  const state = await readAnalysis(deps.store, id);
  if (!state) throw new Error(`El análisis ${id} no existe.`);
  const linked = state.link?.points ?? {};
  const pending = ((await loadPoints(deps.store)) ?? []).filter(
    (point) => !point.outOfScope && targets[point.id] && !linked[point.id],
  );
  const dates = recommendSchedule(
    pending.map((point) => ({ id: point.id, seconds: pointExpectedSeconds(point) ?? 0 })),
    deps.today ?? todayIso(),
  );
  const resolved = new Map<string, Promise<TargetResult>>();
  const results: LinkPointResult[] = [];
  for (const point of pending) {
    const key = targets[point.id];
    if (!resolved.has(key)) resolved.set(key, resolveCreation(deps.jira, state.projectKey, key, false));
    const outcome = await (resolved.get(key) as Promise<TargetResult>);
    if (!outcome.ok) {
      results.push(failure(point.id, outcome.message));
      continue;
    }
    results.push(
      await createOne({
        deps,
        id,
        point,
        parent: outcome.target,
        dueDate: dates.get(point.id) as string,
        run: state.pointRuns[point.id],
      }),
    );
  }
  return results;
}
