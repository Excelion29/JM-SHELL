import * as fs from 'fs-extra';
import { parseEstimate } from './pert';
import { PlannedTask, RefinementPlan, RISKS, Risk } from './types';

export class PlanValidationError extends Error {}

type Raw = Record<string, unknown>;

function fail(message: string): never {
  throw new PlanValidationError(message);
}

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function where(index: number, id?: unknown): string {
  return typeof id === 'string' && id ? `La tarea ${id}` : `La tarea #${index + 1}`;
}

function requireText(raw: Raw, field: string, label: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || !value.trim()) fail(`${label}: falta el campo "${field}" (texto no vacío).`);
  return value;
}

function optionalText(raw: Raw, field: string, label: string): string {
  const value = raw[field];
  if (value === undefined) return '';
  if (typeof value !== 'string') fail(`${label}: el campo "${field}" debe ser texto.`);
  return value;
}

function textList(raw: Raw, field: string, label: string, required: boolean): string[] {
  const value = raw[field];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(`${label}: el campo "${field}" debe ser una lista de textos.`);
  }
  return value as string[];
}

function readEstimate(raw: Raw, label: string): PlannedTask['estimate'] {
  const est = raw.estimate;
  if (!isObject(est)) fail(`${label}: falta el campo "estimate" con optimistic, likely y pessimistic.`);
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

function readTask(raw: unknown, index: number): PlannedTask {
  if (!isObject(raw)) fail(`${where(index)} no es un objeto.`);
  const label = where(index, raw.id);
  const risk = raw.risk;
  if (!RISKS.includes(risk as Risk)) fail(`${label}: "risk" debe ser ${RISKS.join(', ')}.`);
  if (typeof raw.include !== 'boolean') fail(`${label}: "include" debe ser true o false.`);
  return {
    id: requireText(raw, 'id', label),
    summary: requireText(raw, 'summary', label),
    description: optionalText(raw, 'description', label),
    doneCriteria: textList(raw, 'doneCriteria', label, true),
    estimate: readEstimate(raw, label),
    risk: risk as Risk,
    rationale: optionalText(raw, 'rationale', label),
    include: raw.include,
    attachments: textList(raw, 'attachments', label, false),
  };
}

export function validatePlan(raw: unknown): RefinementPlan {
  if (!isObject(raw)) fail('El plan debe ser un objeto JSON.');
  const storyKey = requireText(raw, 'storyKey', 'El plan');
  if (!Array.isArray(raw.tasks)) fail('El plan: falta la lista "tasks".');
  const tasks = raw.tasks.map(readTask);
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) fail(`La tarea ${task.id} está repetida: cada id debe ser único.`);
    seen.add(task.id);
  }
  return { storyKey, tasks };
}

export async function loadPlan(planFile: string): Promise<RefinementPlan> {
  let raw: unknown;
  try {
    raw = await fs.readJson(planFile);
  } catch (err: unknown) {
    fail(`No pude leer ${planFile}: ${(err as Error).message}`);
  }
  return validatePlan(raw);
}
