import { loadProjectConfig } from '../config/loader';
import { defaultAssignee } from '../refinement/create';
import type { JiraService } from '../services/jira';

const NO_ASSIGNEE = 'No encontré a quién asignarla en el proyecto.';

// El responsable configurado en .jira.json; lo comparten los puentes de la app y el comando import
export async function configuredAssignee(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).defaultAssignee || null;
  } catch {
    return null; // sin .jira.json se usa al usuario actual
  }
}

// El responsable de siempre: el configurado en .jira.json o el primero asignable del proyecto
export async function projectAssigneeId(jira: JiraService, projectKey: string): Promise<string> {
  const assignee = await defaultAssignee(jira, projectKey, await configuredAssignee());
  if (!assignee) throw new Error(NO_ASSIGNEE);
  return assignee.accountId;
}
