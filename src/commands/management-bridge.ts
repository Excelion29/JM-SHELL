import type { JiraService } from '../services/jira';
import { resolveManagementTarget } from '../refinement/create';
import type { ManagementBridge } from '../refinement/management-types';
import { isValidIssueKey, projectRoot } from '../refinement/state';
import { stripControlChars } from '../refinement/text';
import { readManagement, saveManagement } from './management-store';

export function createManagementBridge(getJira: () => JiraService): ManagementBridge {
  return {
    status: (projectKey) => readManagement(projectRoot(), projectKey),
    save: async (projectKey, key) => {
      try {
        if (key === null) {
          await saveManagement(projectRoot(), projectKey, null);
          return { ok: true };
        }
        if (!isValidIssueKey(key))
          return { ok: false, message: `La clave "${key}" no es válida. Usa el formato AQ-45.` };
        if (!key.startsWith(`${projectKey}-`)) {
          return { ok: false, message: `${key} no es del proyecto ${projectKey}.` };
        }
        const resolved = await resolveManagementTarget(getJira(), key);
        if (!resolved.ok) return { ok: false, message: resolved.message };
        await saveManagement(projectRoot(), projectKey, {
          key,
          summary: stripControlChars(resolved.target.parentSummary),
        });
        return { ok: true };
      } catch (err: unknown) {
        return { ok: false, message: (err as Error).message };
      }
    },
  };
}
