// Vincular un análisis a Jira (parte 10C): épica del análisis y una tarea (épica) o subtarea (historia) por punto
import { markdownToAdf } from '../utils/adf';
import { readAnalysis, updateAnalysis } from './analysis';
import { POINT_TEXT_MAX_CHARS, POINT_TITLE_MAX_CHARS } from './analysis-point-context';
import { pointStatusOf } from './analysis-point-runs';
import { type AnalysisPoint, loadPoints, pointExpectedSeconds } from './analysis-points';
import type { AnalysisState, LinkPointResult, LinkTargetOutcome } from './analysis-types';
import type { LinkedAnalysisRef } from './knowledge';
import type { CreationTarget, TargetResult } from './review-types';
import { type CreateJira, oneLine, resolveTarget } from './create';
import { categoryOf, type ExecutionJira, finishTask, returnTo, startTask } from './execution';
import { estimateForJira } from './pert';
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

const NEEDS_REOPEN = 'La tarea de Jira está finalizada y hay que reabrirla.';
const NO_PROJECT = 'El análisis no tiene proyecto; no creo nada.';
const NOT_ATTEMPTED = 'No lo intenté: falló el registro anterior.';

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
  if (!projectKey) return { ok: false, message: NO_PROJECT };
  if (projectKeyOfStory(target.parentKey) !== projectKey) {
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

export type SyncTarget = 'start' | 'done';

// moved=false: Jira ya estaba como el punto y no se tocó
export type SyncOutcome =
  | { kind: 'ok'; moved: boolean }
  | { kind: 'choose'; target: SyncTarget; available: string[] }
  | { kind: 'failed'; message: string };

export function noticeOf(outcome: SyncOutcome, key: string): string | null {
  if (outcome.kind === 'ok') return null;
  if (outcome.kind === 'failed') return `No pude mover ${key} en Jira: ${outcome.message}`;
  return `Jira no tiene una transición conocida para ${key}; muévela a mano.`;
}

const ctxOf = (deps: LinkedState) => ({ jira: deps.jira, store: null, transitionMemory: deps.transitionMemory });

function outcomeOf(target: SyncTarget, outcome: TransitionOutcome): SyncOutcome {
  if (outcome.kind === 'ok') return { kind: 'ok', moved: true };
  if (outcome.kind === 'choose') return { kind: 'choose', target, available: outcome.available };
  return { kind: 'failed', message: outcome.kind === 'failed' ? outcome.message : NEEDS_REOPEN };
}

// Sin transición directa a Finalizada desde "Por hacer": se inicia y luego se finaliza
async function finishWithStart(deps: LinkedState, key: string, chosen?: string): Promise<SyncOutcome> {
  const direct = await finishTask(ctxOf(deps), null, key, { transitionName: chosen });
  if (direct.kind !== 'choose' || chosen) return outcomeOf('done', direct);
  const started = await startTask(ctxOf(deps), null, key, { reopen: true });
  if (started.kind !== 'ok') return outcomeOf('done', direct);
  return outcomeOf('done', await finishTask(ctxOf(deps), null, key));
}

// Deja la tarea de Jira como el punto en jm; con la categoría ya igual no hace nada.
// transitionName es la transición que el dev eligió para este tipo de cambio (se recuerda por proyecto)
export async function syncIssue(
  deps: LinkedState,
  key: string,
  status: 'started' | 'done',
  transitionName?: string,
): Promise<SyncOutcome> {
  try {
    const category = categoryOf(await deps.jira.getIssue(key));
    if (category === (status === 'done' ? 'done' : 'indeterminate')) return { kind: 'ok', moved: false };
    if (status === 'started') {
      return outcomeOf('start', await startTask(ctxOf(deps), null, key, { reopen: true, transitionName }));
    }
    if (category === 'indeterminate') {
      return outcomeOf('done', await finishTask(ctxOf(deps), null, key, { transitionName }));
    }
    return await finishWithStart(deps, key, transitionName);
  } catch (err: unknown) {
    return { kind: 'failed', message: (err as Error).message };
  }
}

export const startLinked = (deps: LinkedState, key: string, transitionName?: string): Promise<SyncOutcome> =>
  syncIssue(deps, key, 'started', transitionName);

export const finishLinked = (deps: LinkedState, key: string, transitionName?: string): Promise<SyncOutcome> =>
  syncIssue(deps, key, 'done', transitionName);

// Lo que la pantalla necesita de un resultado de sincronía
function resultOf(pointId: string, issueKey: string, outcome: SyncOutcome): LinkPointResult {
  if (outcome.kind === 'ok') return { pointId, ok: true, issueKey };
  if (outcome.kind === 'choose') {
    return { pointId, ok: true, issueKey, choose: { target: outcome.target, available: outcome.available } };
  }
  return { pointId, ok: true, issueKey, message: noticeOf(outcome, issueKey) ?? '' };
}

// Pone en Jira el estado de cada punto ya vinculado (los que ya coinciden se omiten). Con `choice` el primero
// que lo necesite usa esa transición, que queda recordada, y los demás la reutilizan sin preguntar
export async function syncLinkedPoints(
  deps: LinkedState & { store: StoryStore },
  id: string,
  choice?: { target: SyncTarget; name: string },
): Promise<LinkPointResult[]> {
  const state = await readAnalysis(deps.store, id);
  if (!state) throw new Error(`El análisis ${id} no existe.`);
  let pending = choice;
  const results: LinkPointResult[] = [];
  for (const [pointId, { issueKey }] of Object.entries(state.link?.points ?? {})) {
    const status = pointStatusOf(state.pointRuns[pointId]);
    if (status === 'pending') continue;
    const target: SyncTarget = status === 'done' ? 'done' : 'start';
    const name = pending?.target === target ? pending.name : undefined;
    const outcome = await syncIssue(deps, issueKey, status, name);
    if (outcome.kind === 'ok' && !outcome.moved) continue;
    if (name) pending = undefined;
    results.push(resultOf(pointId, issueKey, outcome));
  }
  return results;
}

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
// recorded=false: la tarea existe en Jira pero jm no la anotó; seguir crearía más sin poder evitar duplicados
async function createOne({
  deps,
  id,
  point,
  parent,
  dueDate,
  run,
}: CreateOne): Promise<{ result: LinkPointResult; recorded: boolean }> {
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
    if (!isValidIssueKey(key)) {
      return { result: failure(point.id, `Jira devolvió una clave inesperada (${key}).`), recorded: false };
    }
  } catch (err: unknown) {
    return { result: failure(point.id, (err as Error).message), recorded: true };
  }
  try {
    await updateAnalysis(deps.store, id, (state) => {
      const link = state.link ?? { epicKey: null, points: {} };
      link.points[point.id] = { issueKey: key, parentKey: parent.parentKey };
      state.link = link;
    });
  } catch (err: unknown) {
    const message = `Creé ${key} en Jira, pero no pude registrarlo en jm (${(err as Error).message}). No reintentes ${point.id}: duplicaría la tarea; anota ${key} a mano.`;
    return { result: { pointId: point.id, ok: true, issueKey: key, message }, recorded: false };
  }
  const status = pointStatusOf(run);
  const synced = status === 'pending' ? null : resultOf(point.id, key, await syncIssue(deps, key, status));
  return { result: synced ?? { pointId: point.id, ok: true, issueKey: key }, recorded: true };
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
  let stopped = false;
  for (const point of pending) {
    if (stopped) {
      results.push(failure(point.id, NOT_ATTEMPTED));
      continue;
    }
    const key = targets[point.id];
    if (!resolved.has(key)) resolved.set(key, resolveCreation(deps.jira, state.projectKey, key, false));
    const outcome = await (resolved.get(key) as Promise<TargetResult>);
    if (!outcome.ok) {
      results.push(failure(point.id, outcome.message));
      continue;
    }
    const created = await createOne({
      deps,
      id,
      point,
      parent: outcome.target,
      dueDate: dates.get(point.id) as string,
      run: state.pointRuns[point.id],
    });
    results.push(created.result);
    stopped = !created.recorded;
  }
  return results;
}

// Análisis vinculados a la épica de una historia (la clave de épica ya implica el mismo proyecto)
export function linkedAnalysesOf(states: AnalysisState[], epicKey: string | null): LinkedAnalysisRef[] {
  if (!epicKey) return [];
  return states.filter((state) => state.link?.epicKey === epicKey).map(({ id, name }) => ({ id, name }));
}
