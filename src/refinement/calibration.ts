// Estimado vs. real con lo que jm guarda por tarea: sin IA ni llamadas a Jira
import { effectiveSeconds, estimateForJira, recommendedSeconds } from './pert';
import type {
  CalibrationGroup,
  CalibrationModel,
  CalibrationOutlier,
  CalibrationRisk,
  HistoryFactor,
  PlanningGroup,
} from './tasks-types';
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
  // La recomendada (PERT): el ajuste se mide contra ella porque es lo que corrige
  recommendedSeconds: number;
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
      recommendedSeconds: recommendedSeconds(task),
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

export const EMPTY_PLANNING: PlanningGroup = { count: 0, estimateSeconds: 0, elapsedSeconds: 0 };

export function calibrate(
  stories: StoryMeasures[],
  unreadable = 0,
  planning: PlanningGroup = EMPTY_PLANNING,
  analysisPoints: PlanningGroup = EMPTY_PLANNING,
): CalibrationModel {
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
    planning,
    analysisPoints,
  };
}

// ── Ajuste de la estimación con el historial (punto 3): fórmula propia, sin IA ──
// Medida: de inicio a fin, lo que de verdad tomó la tarea (con Claude abierto o no)
export const PRIOR_WEIGHT = 5;
export const MIN_RISK_MEASURES = 3;
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 2;

export interface EstimateFactors {
  total: HistoryFactor | null;
  byRisk: Partial<Record<CalibrationRisk, HistoryFactor>>;
}

export const NO_FACTORS: EstimateFactors = { total: null, byRisk: {} };

// Real de inicio a fin ÷ recomendada (no ÷ lo enviado a Jira: si ya se usó el ajustado, el factor se borraría solo).
// Con pocas medidas el factor se acerca a 1 (vale como PRIOR_WEIGHT medidas exactas) y queda entre los topes
function factorOf(measures: TaskMeasure[]): HistoryFactor | null {
  const recommended = measures.reduce((total, m) => total + m.recommendedSeconds, 0);
  if (measures.length === 0 || recommended <= 0) return null;
  const real = measures.reduce((total, m) => total + m.elapsedSeconds, 0);
  const count = measures.length;
  const shrunk = (count * (real / recommended) + PRIOR_WEIGHT) / (count + PRIOR_WEIGHT);
  return { factor: Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, shrunk)), count };
}

export function estimateFactors(stories: StoryMeasures[]): EstimateFactors {
  const measures = stories.flatMap((story) => story.measures);
  const byRisk: EstimateFactors['byRisk'] = {};
  for (const risk of RISKS) {
    const ofRisk = measures.filter((m) => m.risk === risk);
    const factor = ofRisk.length >= MIN_RISK_MEASURES ? factorOf(ofRisk) : null;
    if (factor) byRisk[risk] = factor;
  }
  return { total: factorOf(measures), byRisk };
}

// El factor del mismo riesgo si hay medidas suficientes; si no, el de todas
export const factorFor = (factors: EstimateFactors, risk: CalibrationRisk): HistoryFactor | null =>
  factors.byRisk[risk] ?? factors.total;

export const adjustedSeconds = (recommended: number, factor: HistoryFactor | null): number | null =>
  factor ? estimateForJira(recommended * factor.factor) : null;
