// Estimado vs. real con lo que jm guarda por tarea: sin IA ni llamadas a Jira
import { effectiveSeconds } from './pert';
import type { CalibrationGroup, CalibrationModel, CalibrationOutlier, CalibrationRisk } from './tasks-types';
import { RISKS, type RefinementPlan, type StoryState, type TaskRun } from './types';

export const OUTLIER_LIMIT = 5;
const MS_PER_SECOND = 1000;

export interface RealTimes {
  claudeSeconds: number | null;
  elapsedSeconds: number | null;
}

const NO_REAL_TIMES: RealTimes = { claudeSeconds: null, elapsedSeconds: null };

const toSeconds = (ms: number): number => Math.max(0, Math.round(ms / MS_PER_SECOND));

// Inicio a fin acumulado de un tramo ya cerrado (para conservarlo al reabrir); 0 si no se puede medir
export function elapsedMsOf(run: TaskRun): number {
  const prior = run.priorElapsedMs ?? 0;
  if (!run.startedAt || !run.finishedAt) return prior;
  const span = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isNaN(span) ? prior : prior + Math.max(0, span);
}

// En curso, el tramo de inicio a fin corre hasta ahora; un cierre directo no tiene inicio medido
export function realTimesOf(run: TaskRun | undefined, now: Date): RealTimes {
  if (!run || run.finishedDirect || !run.startedAt) return NO_REAL_TIMES;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now.getTime();
  const start = Date.parse(run.startedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return NO_REAL_TIMES;
  return {
    claudeSeconds: toSeconds(run.activeMs),
    elapsedSeconds: toSeconds((run.priorElapsedMs ?? 0) + Math.max(0, end - start)),
  };
}

export interface TaskMeasure {
  key: string;
  storyKey: string;
  title: string;
  risk: CalibrationRisk;
  estimateSeconds: number;
  claudeSeconds: number;
  elapsedSeconds: number;
}

export interface StoryMeasures {
  measures: TaskMeasure[];
  excludedDirect: number;
}

const isFinished = (run: TaskRun): boolean => run.status === 'done' && run.finishedAt !== null;

// Solo tareas del plan finalizadas tras iniciarlas con jm; la estimación es la que se mandó a Jira
export function measuresOf(state: StoryState, plan: RefinementPlan | null, now: Date): StoryMeasures {
  const measures: TaskMeasure[] = [];
  let excludedDirect = 0;
  for (const [taskId, key] of Object.entries(state.createdIssues)) {
    const run = state.taskRuns[key];
    if (!run || !isFinished(run)) continue;
    const real = realTimesOf(run, now);
    // Sin inicio medido: cerrada con f, o finalizada sin haberla iniciado con jm (0 con Claude y 0 de inicio a fin)
    if (run.finishedDirect || (!real.claudeSeconds && !real.elapsedSeconds)) {
      excludedDirect += 1;
      continue;
    }
    const task = plan?.tasks.find((t) => t.id === taskId);
    if (!task || real.claudeSeconds === null || real.elapsedSeconds === null) continue;
    measures.push({
      key,
      storyKey: state.key,
      title: task.summary,
      risk: task.risk,
      estimateSeconds: effectiveSeconds(task),
      claudeSeconds: real.claudeSeconds,
      elapsedSeconds: real.elapsedSeconds,
    });
  }
  return { measures, excludedDirect };
}

const ratio = (real: number, estimate: number): number | null => (estimate > 0 ? real / estimate : null);

function groupOf(measures: TaskMeasure[]): CalibrationGroup {
  const sum = (pick: (m: TaskMeasure) => number) => measures.reduce((total, m) => total + pick(m), 0);
  const estimateSeconds = sum((m) => m.estimateSeconds);
  const claudeSeconds = sum((m) => m.claudeSeconds);
  const elapsedSeconds = sum((m) => m.elapsedSeconds);
  return {
    count: measures.length,
    estimateSeconds,
    claudeSeconds,
    elapsedSeconds,
    claudeRatio: ratio(claudeSeconds, estimateSeconds),
    elapsedRatio: ratio(elapsedSeconds, estimateSeconds),
  };
}

const deviation = (m: TaskMeasure): number => Math.abs(m.claudeSeconds - m.estimateSeconds);

function outlierOf(m: TaskMeasure): CalibrationOutlier {
  const { key, storyKey, title, estimateSeconds, claudeSeconds, elapsedSeconds } = m;
  return { key, storyKey, title, estimateSeconds, claudeSeconds, elapsedSeconds };
}

export function calibrate(stories: StoryMeasures[], unreadable = 0): CalibrationModel {
  const measures = stories.flatMap((story) => story.measures);
  return {
    total: groupOf(measures),
    byRisk: RISKS.map((risk) => ({ risk, ...groupOf(measures.filter((m) => m.risk === risk)) })).filter(
      (group) => group.count > 0,
    ),
    outliers: [...measures]
      .sort((a, b) => deviation(b) - deviation(a))
      .slice(0, OUTLIER_LIMIT)
      .map(outlierOf),
    excludedDirect: stories.reduce((total, story) => total + story.excludedDirect, 0),
    unreadable,
  };
}
