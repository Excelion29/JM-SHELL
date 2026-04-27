import { loadContext, saveContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { issueTypeIcon, success, info, error } from '../utils/format';
import chalk from 'chalk';

export async function upCommand(): Promise<void> {
  const ctx = await loadContext();

  if (!ctx) {
    info('Ya estás en el nivel raíz. Ejecuta `jdf list` para ver las Épicas.');
    return;
  }

  // Si tiene padre, subir al padre
  if (ctx.parentKey) {
    const globalConfig = await requireAuth();
    const jira = new JiraService(globalConfig);

    let parent;
    try {
      parent = await jira.getIssue(ctx.parentKey);
    } catch (err: unknown) {
      error(`No se pudo obtener el issue padre: ${(err as Error).message}`);
      process.exit(1);
    }

    const newCtx = {
      issueKey: parent.key,
      summary: parent.fields.summary,
      issueType: parent.fields.issuetype.name,
      parentKey: parent.fields.parent?.key,
      parentSummary: parent.fields.parent?.fields.summary,
    };

    await saveContext(newCtx);
    const icon = issueTypeIcon(newCtx.issueType);
    success(`Subiste a: ${icon} ${chalk.bold(newCtx.issueKey)} — ${newCtx.summary}`);
    info(`Ejecuta ${chalk.cyan('jdf list')} para ver el contenido.`);
    return;
  }

  // No tiene padre → volver al nivel raíz (épicas), limpiar contexto
  // Guardamos un contexto vacío borrando el archivo
  const { findFileUpward } = await import('../config/loader');
  const contextPath = findFileUpward('.jira-context.json');
  if (contextPath) {
    const fs = await import('fs-extra');
    await fs.remove(contextPath);
  }

  success(`Volviste al nivel raíz — ${chalk.bold('Épicas del proyecto')}`);
  info(`Ejecuta ${chalk.cyan('jdf list')} para ver las Épicas.`);
}
