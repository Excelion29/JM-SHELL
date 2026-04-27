import { saveContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { success, error, info } from '../utils/format';
import { issueTypeIcon } from '../utils/format';
import chalk from 'chalk';

export async function useCommand(issueKey: string): Promise<void> {
  const normalized = issueKey.toUpperCase().trim();
  if (!/^[A-Z]+-\d+$/.test(normalized)) {
    error(`Clave inválida: "${issueKey}". Formato esperado: AUTH-123`);
    process.exit(1);
  }

  const globalConfig = await requireAuth();
  const jira = new JiraService(globalConfig);

  let issue;
  try {
    issue = await jira.getIssue(normalized);
  } catch (err: unknown) {
    error(`Issue no encontrado: ${(err as Error).message}`);
    process.exit(1);
  }

  const ctx = {
    issueKey: normalized,
    summary: issue.fields.summary,
    issueType: issue.fields.issuetype.name,
    parentKey: issue.fields.parent?.key,
    parentSummary: issue.fields.parent?.fields.summary,
  };

  try {
    await saveContext(ctx);
    const icon = issueTypeIcon(ctx.issueType);
    success(`Contexto: ${icon} ${chalk.bold(normalized)} — ${ctx.summary}`);
    info(`Ejecuta ${chalk.cyan('jdf list')} para ver el contenido.`);
  } catch (err: unknown) {
    error(`Error al guardar contexto: ${(err as Error).message}`);
    process.exit(1);
  }
}
