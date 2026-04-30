import { loadProjectConfig, loadContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { getLevel, getAvailableTypes } from '../utils/issueTypes';
import { issueTypeIcon, info, error } from '../utils/format';
import chalk from 'chalk';

const LEVEL_LABEL: Record<string, string> = {
  root:     'raíz (sin contexto)',
  epic:     'dentro de una Épica',
  standard: 'dentro de una Historia / Tarea / Bug',
  subtask:  'dentro de una Subtarea',
};

export async function typesCommand(): Promise<void> {
  const globalConfig = await requireAuth();

  let projectConfig;
  try {
    projectConfig = await loadProjectConfig();
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const ctx = await loadContext();
  const level = getLevel(ctx);

  const where = ctx
    ? `${issueTypeIcon(ctx.issueType ?? '')} ${chalk.bold(ctx.issueKey)} — ${ctx.summary}`
    : chalk.dim('sin contexto activo');

  console.log(`\n  Ubicación: ${where}`);
  console.log(`  Nivel:     ${chalk.dim(LEVEL_LABEL[level] ?? level)}\n`);

  if (level === 'subtask') {
    info('Estás dentro de una subtarea — no se pueden crear issues aquí.');
    console.log(`  Usa ${chalk.cyan('jdf up')} para subir un nivel.\n`);
    return;
  }

  const jira = new JiraService(globalConfig);
  const available = await getAvailableTypes(jira, projectConfig.projectKey, level);

  if (available.length === 0) {
    info('No se encontraron tipos disponibles para este nivel.');
    return;
  }

  console.log(chalk.bold(`  Tipos que puedes crear aquí:\n`));
  for (const t of available) {
    const icon = issueTypeIcon(t.name);
    const tag = t.subtask ? chalk.dim(' (subtarea)') : '';
    console.log(`  ${icon}  ${t.name}${tag}`);
  }
  console.log();
}
