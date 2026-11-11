import { JiraIssue } from '../config/types';
import { isValidIssueKey } from './state';
import { stripControlChars } from './text';
import { BrowseItem } from './types';

export const BROWSE_LIMIT = 100;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const NOT_SUBTASK = 'issuetype not in subtaskIssueTypes()';

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_PATTERN.test(key);
}

function assertProjectKey(key: string): void {
  if (!isValidProjectKey(key)) throw new Error(`La clave de proyecto "${key}" no es válida. Usa el formato AQ.`);
}

export function buildEpicsJql(projectKey: string): string {
  assertProjectKey(projectKey);
  return `project = ${projectKey} AND issuetype = Epic ORDER BY rank ASC`;
}

export function buildStoriesJql(projectKey: string, epicKey: string | null): string {
  assertProjectKey(projectKey);
  if (epicKey === null) {
    return `project = ${projectKey} AND issuetype != Epic AND ${NOT_SUBTASK} AND parent is EMPTY ORDER BY updated DESC`;
  }
  if (!isValidIssueKey(epicKey)) throw new Error(`La clave de épica "${epicKey}" no es válida. Usa el formato AQ-45.`);
  return `parent = ${epicKey} AND ${NOT_SUBTASK} ORDER BY updated DESC`;
}

// El texto viene de Jira: se limpia antes de llegar a la terminal
export function toBrowseItem(issue: JiraIssue): BrowseItem {
  return {
    key: issue.key,
    summary: stripControlChars(issue.fields.summary),
    status: stripControlChars(issue.fields.status.name),
  };
}

// Número de la clave (PGC-15 → 15); una clave sin número va al final
const keyNumber = (key: string): number => {
  const number = Number(key.slice(key.lastIndexOf('-') + 1));
  return Number.isInteger(number) ? number : Number.MAX_SAFE_INTEGER;
};

// Orden por código de menor a mayor: PGC-15 antes que PGC-25
export function sortByKey<T extends { key: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => keyNumber(a.key) - keyNumber(b.key) || a.key.localeCompare(b.key));
}

export function filterByProject<T extends { key: string }>(stories: T[], projectKey: string | null): T[] {
  if (!projectKey) return stories;
  return stories.filter((story) => story.key.startsWith(`${projectKey}-`));
}
