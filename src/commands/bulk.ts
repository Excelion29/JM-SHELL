import inquirer from 'inquirer';
import { loadProjectConfig, loadContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { parseTime } from '../utils/time';
import { success, error, info, warn, issueTypeIcon } from '../utils/format';
import { getLevel, getAvailableTypes } from '../utils/issueTypes';
import chalk from 'chalk';

export async function bulkCommand(): Promise<void> {
  const globalConfig = await requireAuth();

  let projectConfig;
  try {
    projectConfig = await loadProjectConfig();
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);
  const ctx = await loadContext();
  const level = getLevel(ctx);

  if (level === 'subtask') {
    error(`No se pueden crear issues dentro de una subtarea (${ctx!.issueKey}).`);
    info(`Usa ${chalk.cyan('jdf up')} para subir al nivel correcto.`);
    process.exit(1);
  }

  // ── Resolver padre ────────────────────────────────────────────
  let parentKey: string | undefined;

  if (ctx) {
    parentKey = ctx.issueKey;
    info(`Creando tareas dentro de: ${issueTypeIcon(ctx.issueType ?? '')} ${chalk.bold(ctx.issueKey)} — ${ctx.summary}`);
  } else {
    const { parent } = await inquirer.prompt([{
      type: 'input',
      name: 'parent',
      message: 'Clave del issue padre (ej: PM-100, o Enter para nivel raíz):',
    }]);
    parentKey = parent.trim().toUpperCase() || undefined;
  }

  // ── Tipo de issue ─────────────────────────────────────────────
  const available = await getAvailableTypes(jira, projectConfig.projectKey, level);
  let issueTypeName: string;

  if (available.length === 0) {
    issueTypeName = 'Task';
  } else if (available.length === 1) {
    issueTypeName = available[0].name;
  } else {
    const { chosen } = await inquirer.prompt([{
      type: 'list',
      name: 'chosen',
      message: 'Tipo de issue para todas las tareas:',
      choices: available.map((t) => ({
        name: `${issueTypeIcon(t.name)}  ${t.name}`,
        value: t.name,
        short: t.name,
      })),
    }]);
    issueTypeName = chosen;
  }

  // ── Cargar usuarios asignables ────────────────────────────────
  let users: Array<{ accountId: string; displayName: string }> = [];
  try {
    users = await jira.getAssignableUsers(projectConfig.projectKey);
  } catch {
    warn('No se pudieron cargar los usuarios. Se usará el asignado por defecto.');
  }

  const me = await jira.getMyself();
  const userChoices = [
    { name: `${me.displayName} (yo) — por defecto`, value: projectConfig.defaultAssignee ?? me.accountId, short: me.displayName },
    ...users
      .filter((u) => u.accountId !== me.accountId)
      .map((u) => ({ name: u.displayName, value: u.accountId, short: u.displayName })),
  ];

  // ── Loop de creación ──────────────────────────────────────────
  console.log(chalk.bold(`\n  Ingresa las tareas a crear. Deja el título vacío para terminar.\n`));

  const created: Array<{ key: string; summary: string }> = [];
  let index = 1;

  while (true) {
    const { summary } = await inquirer.prompt([{
      type: 'input',
      name: 'summary',
      message: `Tarea ${index} — Título (Enter para terminar):`,
    }]);

    if (!summary.trim()) break;

    // Opcionales por tarea
    const extras = await inquirer.prompt([
      {
        type: users.length > 0 ? 'list' : 'input',
        name: 'assignee',
        message: 'Asignar a:',
        choices: userChoices,
        default: userChoices[0].value,
      },
      {
        type: 'input',
        name: 'due',
        message: 'Fecha de vencimiento (YYYY-MM-DD, Enter para omitir):',
        validate: (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) ? true : 'Formato: YYYY-MM-DD',
      },
      {
        type: 'input',
        name: 'estimate',
        message: 'Estimación (1h, 30m, 1h30m, Enter para omitir):',
      },
    ]);

    let estimateSeconds: number | undefined;
    if (extras.estimate?.trim()) {
      try { estimateSeconds = parseTime(extras.estimate.trim()); } catch { /* omitir */ }
    }

    try {
      const issue = await jira.createIssue({
        projectKey: projectConfig.projectKey,
        summary: summary.trim(),
        issueTypeName,
        assigneeId: extras.assignee,
        estimateSeconds,
        dueDate: extras.due?.trim() || undefined,
        parentKey,
      });
      success(`${chalk.bold(issue.key)} — ${summary.trim()}`);
      created.push({ key: issue.key, summary: summary.trim() });
      index++;
    } catch (err: unknown) {
      error(`Error al crear "${summary}": ${(err as Error).message}`);
    }

    console.log();
  }

  // ── Resumen ───────────────────────────────────────────────────
  if (created.length === 0) {
    info('No se creó ninguna tarea.');
    return;
  }

  console.log(chalk.bold(`\n  Resumen — ${created.length} tarea(s) creada(s) en estado "Por hacer":\n`));
  for (const t of created) {
    console.log(`  ${chalk.cyan(t.key)}  ${t.summary}`);
    console.log(`  ${chalk.underline.blue(jira.getBrowseUrl(t.key))}\n`);
  }
}
