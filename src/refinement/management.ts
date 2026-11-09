import { isValidProjectKey } from './browse';
import type { ManagementIssue, ManagementStatus } from './management-types';
import { isValidIssueKey } from './state';
import { stripControlChars } from './text';

export const MANAGEMENT_SUMMARY_MAX_LENGTH = 120;

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseIssue(raw: unknown): ManagementIssue | null {
  if (!isRecord(raw) || typeof raw.key !== 'string' || typeof raw.summary !== 'string') return null;
  return isValidIssueKey(raw.key) ? { key: raw.key, summary: stripControlChars(raw.summary).slice(0, MANAGEMENT_SUMMARY_MAX_LENGTH) } : null;
}

// Un valor ilegible cuenta como sin responder: se vuelve a preguntar y al guardar se corrige
export function managementStatusOf(project: RawRecord | null, projectKey: string): ManagementStatus {
  const map = project?.management;
  if (!isValidProjectKey(projectKey) || !isRecord(map) || !Object.prototype.hasOwnProperty.call(map, projectKey)) return 'unset';
  const entry = map[projectKey];
  if (entry === null) return 'none';
  return parseIssue(entry) ?? 'unset';
}

// Conserva todos los demás campos y los valores de los otros proyectos
export function withManagement(project: RawRecord, projectKey: string, value: ManagementIssue | null): RawRecord {
  if (!isValidProjectKey(projectKey)) throw new Error(`La clave de proyecto "${projectKey}" no es válida.`);
  if (value && !parseIssue(value)) throw new Error(`La clave de gestión "${value.key}" no es válida.`);
  const previous = isRecord(project.management) ? project.management : {};
  return { ...project, management: { ...previous, [projectKey]: value } };
}

export const managementPlanningSummary = (storyKey: string, date: string): string =>
  `Planificación · ${storyKey} · ${date}`;
