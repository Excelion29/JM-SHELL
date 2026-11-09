import { loadProjectConfig } from '../config/loader';

// El responsable configurado en .jira.json; lo comparten los puentes de la app y el comando import
export async function configuredAssignee(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).defaultAssignee || null;
  } catch {
    return null; // sin .jira.json se usa al usuario actual
  }
}
