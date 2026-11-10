// puntos.json de un análisis: lo escribe Claude y jm lo valida solo para mostrar la cuenta y el total esperado
import { ANALYSIS_POINTS_FILE, isValidPointId, readClaudeJsonText } from './analysis';
import { expectedSeconds, parseEstimate } from './pert';
import type { StoryStore } from './story-store';
import { RISKS, Risk, TaskEstimate } from './types';

export class PointsValidationError extends Error {}

export interface AnalysisPoint {
  id: string;
  title: string;
  analysis: string;
  proposal: string;
  outOfScope: boolean;
  // Un punto fuera de alcance puede no llevar estimación
  estimate: TaskEstimate | null;
  // null solo en un punto fuera de alcance que no lo trae
  risk: Risk | null;
}

export interface PointsTotals {
  pointCount: number;
  expectedSeconds: number;
}

type Raw = Record<string, unknown>;

const fail = (message: string): never => {
  throw new PointsValidationError(message);
};

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const where = (index: number, id?: unknown) =>
  typeof id === 'string' && id ? `El punto ${id}` : `El punto #${index + 1}`;

function requireText(raw: Raw, field: string, label: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || !value.trim()) fail(`${label}: falta el campo "${field}" (texto no vacío).`);
  return value as string;
}

const optionalText = (value: unknown): string => (typeof value === 'string' ? value : '');

function readEstimate(raw: Raw, label: string): TaskEstimate {
  const est = raw.estimate;
  if (!isObject(est)) return fail(`${label}: falta el campo "estimate" con optimistic, likely y pessimistic.`);
  const estimate = {
    optimistic: requireText(est, 'optimistic', `${label} (estimate)`),
    likely: requireText(est, 'likely', `${label} (estimate)`),
    pessimistic: requireText(est, 'pessimistic', `${label} (estimate)`),
  };
  try {
    parseEstimate(estimate);
  } catch (err: unknown) {
    fail(`${label}: estimación inválida. ${(err as Error).message}`);
  }
  return estimate;
}

function readPoint(raw: unknown, index: number): AnalysisPoint {
  if (!isObject(raw)) return fail(`${where(index)} no es un objeto.`);
  const label = where(index, raw.id);
  if (typeof raw.outOfScope !== 'boolean') fail(`${label}: "outOfScope" debe ser true o false.`);
  const outOfScope = raw.outOfScope === true;
  // Un punto fuera de alcance no se trabaja: puede no traer riesgo
  const noRisk = outOfScope && (raw.risk === undefined || raw.risk === null);
  if (!noRisk && !RISKS.includes(raw.risk as Risk)) fail(`${label}: "risk" debe ser ${RISKS.join(', ')}.`);
  const id = requireText(raw, 'id', label);
  if (!isValidPointId(id)) fail(`${label}: el "id" debe ser P1, P2, … (la letra P y un número).`);
  return {
    id,
    title: requireText(raw, 'title', label),
    // Fuera de alcance no hay propuesta que trabajar: puede venir vacía
    analysis: outOfScope ? optionalText(raw.analysis) : requireText(raw, 'analysis', label),
    proposal: outOfScope ? optionalText(raw.proposal) : requireText(raw, 'proposal', label),
    outOfScope,
    estimate: outOfScope && (raw.estimate === undefined || raw.estimate === null) ? null : readEstimate(raw, label),
    risk: noRisk ? null : (raw.risk as Risk),
  };
}

export function validatePoints(raw: unknown): AnalysisPoint[] {
  if (!isObject(raw) || !Array.isArray(raw.points)) return fail('puntos.json: falta la lista "points".');
  const points = raw.points.map(readPoint);
  const seen = new Set<string>();
  for (const point of points) {
    if (seen.has(point.id)) fail(`El punto ${point.id} está repetido: cada id debe ser único.`);
    seen.add(point.id);
  }
  return points;
}

// PERT esperado de un punto; null si no tiene estimación
export function pointExpectedSeconds(point: AnalysisPoint): number | null {
  if (!point.estimate) return null;
  const { optimistic, likely, pessimistic } = parseEstimate(point.estimate);
  return Math.round(expectedSeconds(optimistic, likely, pessimistic));
}

// Solo cuentan los puntos dentro del alcance
export function pointsTotals(points: AnalysisPoint[]): PointsTotals {
  let expected = 0;
  let pointCount = 0;
  for (const point of points) {
    if (point.outOfScope || !point.estimate) continue;
    const { optimistic, likely, pessimistic } = parseEstimate(point.estimate);
    expected += expectedSeconds(optimistic, likely, pessimistic);
    pointCount += 1;
  }
  return { pointCount, expectedSeconds: Math.round(expected) };
}

// null si aún no hay puntos.json; lanza PointsValidationError si no es válido
export async function loadPoints(store: StoryStore): Promise<AnalysisPoint[] | null> {
  let raw: unknown;
  try {
    const text = await readClaudeJsonText(store, ANALYSIS_POINTS_FILE);
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch (err: unknown) {
    return fail(`No pude leer ${store.label}/${ANALYSIS_POINTS_FILE}: ${(err as Error).message}`);
  }
  return validatePoints(raw);
}
