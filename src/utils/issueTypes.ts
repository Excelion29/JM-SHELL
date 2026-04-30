import { JiraService } from '../services/jira';
import { JiraContext } from '../config/types';

export type IssueTypeInfo = { id: string; name: string; subtask: boolean };

const EPIC_NAMES = ['epic', 'épica', 'epica'];
const SUBTASK_NAMES = ['subtask', 'subtarea', 'sub-task'];

export function isEpicType(name: string): boolean {
  return EPIC_NAMES.some((e) => name.toLowerCase().includes(e));
}

export function isSubtaskType(t: IssueTypeInfo): boolean {
  return t.subtask || SUBTASK_NAMES.some((s) => t.name.toLowerCase().includes(s));
}

export type HierarchyLevel = 'root' | 'epic' | 'standard' | 'subtask';

export function getLevel(ctx: JiraContext | null): HierarchyLevel {
  if (!ctx) return 'root';
  const lower = ctx.issueType?.toLowerCase() ?? '';
  if (EPIC_NAMES.some((e) => lower.includes(e))) return 'epic';
  if (SUBTASK_NAMES.some((s) => lower.includes(s))) return 'subtask';
  return 'standard';
}

/**
 * Devuelve los tipos creables según en dónde estás en la jerarquía:
 * - root   → todos los tipos incluyendo Épica
 * - epic   → tipos normales (Historia, Bug, Tarea…) sin Épica ni Subtarea
 * - standard → solo subtareas
 * - subtask → nada (error en el caller)
 */
export async function getAvailableTypes(
  jira: JiraService,
  projectKey: string,
  level: HierarchyLevel
): Promise<IssueTypeInfo[]> {
  let types: IssueTypeInfo[] = [];
  try {
    types = await jira.getIssueTypes(projectKey);
  } catch {
    return [];
  }

  switch (level) {
    case 'root':
      // Todo menos subtareas
      return types.filter((t) => !isSubtaskType(t));

    case 'epic':
      // Todo menos Épicas y Subtareas
      return types.filter((t) => !isSubtaskType(t) && !isEpicType(t.name));

    case 'standard':
      // Solo subtareas
      return types.filter((t) => isSubtaskType(t));

    case 'subtask':
      return [];
  }
}
