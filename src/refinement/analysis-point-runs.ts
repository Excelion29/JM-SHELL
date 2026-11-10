// Puntos de un análisis como tareas solo de jm (sin Jira): estado y tiempo medido por punto en estado.json
import { isValidPointId, readAnalysis, updateAnalysis } from './analysis';
import { type AnalysisPoint, loadPoints, PointsValidationError, pointExpectedSeconds } from './analysis-points';
import type { PointRow, PointsModel, PointStartOutcome, PointStatus } from './analysis-types';
import { elapsedMsOf, realTimesOf } from './calibration';
import { POINT_TITLE_MAX_CHARS } from './analysis-point-context';
import type { StoryStore } from './story-store';
import { stripControlChars } from './text';
import type { PlanningGroup } from './tasks-types';
import type { TaskRun } from './types';

const INVALID_MESSAGE_MAX_CHARS = 300;

const MS_PER_SECOND = 1000;

export function pointStatusOf(run: TaskRun | undefined): PointStatus {
  if (!run || run.returned) return 'pending';
  return run.status === 'done' ? 'done' : 'started';
}

const inScope = (points: AnalysisPoint[]): AnalysisPoint[] => points.filter((point) => !point.outOfScope);

function rowOf(point: AnalysisPoint, run: TaskRun | undefined, issueKey: string | null, now: Date): PointRow {
  const real = realTimesOf(run, now);
  return {
    id: point.id,
    title: stripControlChars(point.title).slice(0, POINT_TITLE_MAX_CHARS),
    status: pointStatusOf(run),
    estimateSeconds: pointExpectedSeconds(point),
    realClaudeSeconds: real.claudeSeconds,
    realElapsedSeconds: real.elapsedSeconds,
    issueKey,
  };
}

export async function loadPointsModel(store: StoryStore, id: string, now: Date = new Date()): Promise<PointsModel> {
  const state = await readAnalysis(store, id);
  if (!state) throw new Error(`El análisis ${id} no existe.`);
  const base = { id, name: state.name };
  try {
    const points = await loadPoints(store);
    if (points === null) return { kind: 'missing', ...base };
    return {
      kind: 'ready',
      ...base,
      rows: inScope(points).map((point) =>
        rowOf(point, state.pointRuns[point.id], state.link?.points[point.id]?.issueKey ?? null, now),
      ),
    };
  } catch (err: unknown) {
    // El mensaje puede repetir texto de puntos.json (lo escribe Claude): sin secuencias de terminal y acotado
    if (err instanceof PointsValidationError)
      return { kind: 'invalid', ...base, message: stripControlChars(err.message).slice(0, INVALID_MESSAGE_MAX_CHARS) };
    throw err;
  }
}

// El punto debe existir en puntos.json y estar dentro del alcance: el id llega de la pantalla, no se da por bueno
export async function requireScopedPoint(store: StoryStore, pointId: string): Promise<AnalysisPoint> {
  if (!isValidPointId(pointId)) throw new Error(`Id de punto inválido: "${pointId}". Usa el formato P1.`);
  const point = inScope((await loadPoints(store)) ?? []).find((candidate) => candidate.id === pointId);
  if (!point) throw new Error(`El punto ${pointId} no existe o está fuera de alcance.`);
  return point;
}

export async function startPoint(
  store: StoryStore,
  id: string,
  pointId: string,
  options: { reopen?: boolean } = {},
  now: Date = new Date(),
): Promise<PointStartOutcome> {
  try {
    await requireScopedPoint(store, pointId);
    const current = (await readAnalysis(store, id))?.pointRuns[pointId];
    if (pointStatusOf(current) === 'done' && !options.reopen) return { kind: 'needs-reopen' };
    await updateAnalysis(store, id, (state) => {
      const previous = state.pointRuns[pointId];
      if (pointStatusOf(previous) === 'started') return;
      const priorElapsedMs = previous ? elapsedMsOf(previous) : 0;
      state.pointRuns[pointId] = {
        issueKey: pointId,
        claudeSessionId: previous?.claudeSessionId ?? null,
        startedAt: now.toISOString(),
        finishedAt: null,
        activeMs: previous?.activeMs ?? 0,
        status: 'started',
        ...(priorElapsedMs > 0 ? { priorElapsedMs } : {}),
      };
    });
    return { kind: 'ok' };
  } catch (err: unknown) {
    return { kind: 'failed', message: (err as Error).message };
  }
}

// Sin inicio medido (f directo) el punto queda finalizado pero fuera de la calibración
export async function finishPoint(
  store: StoryStore,
  id: string,
  pointId: string,
  now: Date = new Date(),
): Promise<void> {
  await requireScopedPoint(store, pointId);
  const finishedAt = now.toISOString();
  await updateAnalysis(store, id, (state) => {
    const run = state.pointRuns[pointId];
    if (!run) {
      state.pointRuns[pointId] = {
        issueKey: pointId,
        claudeSessionId: null,
        startedAt: null,
        finishedAt,
        activeMs: 0,
        status: 'done',
        finishedDirect: true,
      };
      return;
    }
    if (run.status === 'done') return;
    if (!run.returned) run.finishedAt = finishedAt;
    delete run.returned;
    run.status = 'done';
  });
}

// Vuelve a pendiente conservando el tiempo acumulado: el tramo abierto se cierra aquí
export async function giveBackPoint(
  store: StoryStore,
  id: string,
  pointId: string,
  now: Date = new Date(),
): Promise<void> {
  await requireScopedPoint(store, pointId);
  await updateAnalysis(store, id, (state) => {
    const run = state.pointRuns[pointId];
    if (pointStatusOf(run) !== 'started') throw new Error(`${pointId} no está en curso: no hay nada que devolver.`);
    run.finishedAt = now.toISOString();
    run.returned = true;
  });
}

export async function addPointActiveTime(
  store: StoryStore,
  id: string,
  pointId: string,
  elapsedMs: number,
): Promise<void> {
  await updateAnalysis(store, id, (state) => {
    const run = state.pointRuns[pointId];
    if (run) run.activeMs += elapsedMs;
  });
}

export interface PointsCalibrationSource {
  points: AnalysisPoint[];
  runs: Record<string, TaskRun>;
}

// Puntos finalizados tras iniciarlos con jm: lo esperado por Claude y el real de inicio a fin
export function pointsGroupOf(sources: PointsCalibrationSource[]): PlanningGroup {
  const group: PlanningGroup = { count: 0, estimateSeconds: 0, elapsedSeconds: 0 };
  for (const { points, runs } of sources) {
    for (const point of inScope(points)) {
      const run = runs[point.id];
      const estimateSeconds = pointExpectedSeconds(point);
      if (!run || estimateSeconds === null || pointStatusOf(run) !== 'done' || !run.finishedAt) continue;
      if (run.finishedDirect) continue;
      const elapsedSeconds = Math.round(elapsedMsOf(run) / MS_PER_SECOND);
      if (elapsedSeconds <= 0) continue;
      group.count += 1;
      group.estimateSeconds += estimateSeconds;
      group.elapsedSeconds += elapsedSeconds;
    }
  }
  return group;
}
