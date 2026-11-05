import { parseTime } from '../utils/time';
import { PlannedTask, RefinementPlan, TaskEstimate } from './types';

const PERT_LIKELY_WEIGHT = 4;
const PERT_DIVISOR = 6;

export function expectedSeconds(optimistic: number, likely: number, pessimistic: number): number {
  return (optimistic + PERT_LIKELY_WEIGHT * likely + pessimistic) / PERT_DIVISOR;
}

export function stdDevSeconds(optimistic: number, pessimistic: number): number {
  return (pessimistic - optimistic) / PERT_DIVISOR;
}

export interface ParsedEstimate {
  optimistic: number;
  likely: number;
  pessimistic: number;
}

export function parseEstimate(estimate: TaskEstimate): ParsedEstimate {
  const optimistic = parseTime(estimate.optimistic);
  const likely = parseTime(estimate.likely);
  const pessimistic = parseTime(estimate.pessimistic);
  if (optimistic <= 0) throw new Error('El optimista debe ser mayor que 0.');
  if (!(optimistic <= likely && likely <= pessimistic)) {
    throw new Error('Debe cumplirse optimista <= probable <= pesimista.');
  }
  return { optimistic, likely, pessimistic };
}

export function taskExpectedSeconds(task: PlannedTask): number {
  const { optimistic, likely, pessimistic } = parseEstimate(task.estimate);
  return expectedSeconds(optimistic, likely, pessimistic);
}

// Jira trabaja mejor con estimaciones redondas; los decimales del PERT no aportan
export const ESTIMATE_ROUND_SECONDS = 5 * 60;

export function estimateForJira(expected: number): number {
  return Math.max(ESTIMATE_ROUND_SECONDS, Math.round(expected / ESTIMATE_ROUND_SECONDS) * ESTIMATE_ROUND_SECONDS);
}

export const recommendedSeconds = (task: PlannedTask): number => estimateForJira(taskExpectedSeconds(task));

export function parseFinalEstimate(text: string): number {
  const seconds = parseTime(text);
  if (seconds <= 0) throw new Error('La estimación final debe ser mayor que 0.');
  return seconds;
}

// Lo que va a Jira: la estimación del dev si la fijó, si no la recomendación
export const effectiveSeconds = (task: PlannedTask): number =>
  task.finalEstimate ? parseFinalEstimate(task.finalEstimate) : recommendedSeconds(task);

export interface PlanTotals {
  taskCount: number;
  expectedSeconds: number;
  effectiveSeconds: number;
  stdDevSeconds: number;
}

// La desviación total suma varianzas (tareas independientes), no desviaciones
export function planTotals(plan: RefinementPlan): PlanTotals {
  let expected = 0;
  let effective = 0;
  let variance = 0;
  let taskCount = 0;
  for (const task of plan.tasks) {
    if (!task.include) continue;
    const { optimistic, likely, pessimistic } = parseEstimate(task.estimate);
    expected += expectedSeconds(optimistic, likely, pessimistic);
    effective += effectiveSeconds(task);
    variance += stdDevSeconds(optimistic, pessimistic) ** 2;
    taskCount += 1;
  }
  return {
    taskCount,
    expectedSeconds: Math.round(expected),
    effectiveSeconds: effective,
    stdDevSeconds: Math.round(Math.sqrt(variance)),
  };
}
