import inquirer from 'inquirer';
import { loadProjectConfig, loadContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { parseTime } from '../utils/time';
import { success, error, info, issueTypeIcon } from '../utils/format';
import { transitionWithFallback } from '../utils/transition';
import { getLevel, getAvailableTypes } from '../utils/issueTypes';
import chalk from 'chalk';

interface DoOptions {
  due?: string;
  estimate?: string;
  parent?: string;
  assign?: string;
  type?: string;
}

export async function doCommand(summary: string, timeArg: string | undefined, options: DoOptions): Promise<void> {
  const rawTime = timeArg ?? options.estimate;

  if (!rawTime) {
    error('Debes indicar el tiempo: como argumento (1h) o con --estimate 1h');
    process.exit(1);
  }

  let estimateSeconds: number | undefined;
  try {
    estimateSeconds = parseTime(rawTime);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const dueDate = options.due ?? todayISO();
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

  // ── Padre automático desde contexto ──────────────────────────
  let parentKey = options.parent;
  if (!parentKey && ctx) {
    parentKey = ctx.issueKey;
    info(`Creando dentro de: ${issueTypeIcon(ctx.issueType ?? '')} ${chalk.bold(ctx.issueKey)} — ${ctx.summary}`);
  }

  // ── Nivel jerárquico y tipos disponibles ─────────────────────
  const level = getLevel(ctx);

  if (level === 'subtask') {
    error(`No se pueden crear issues dentro de una subtarea (${ctx!.issueKey}).`);
    info(`Usa ${chalk.cyan('jdf up')} para subir al nivel correcto.`);
    process.exit(1);
  }

  let issueTypeName = options.type;
  let issueTypeId: string | undefined;

  const available = await getAvailableTypes(jira, projectConfig.projectKey, level);

  if (issueTypeName) {
    const found = available.find(
      (t) => t.name.toLowerCase() === issueTypeName!.toLowerCase() || t.id === issueTypeName
    );
    if (found) {
      issueTypeName = found.name;
      issueTypeId = found.id;
    }
  } else {
    if (available.length === 0) {
      issueTypeName = 'Task';
    } else if (available.length === 1) {
      issueTypeName = available[0].name;
      issueTypeId = available[0].id;
    } else {
      const { chosen } = await inquirer.prompt([{
        type: 'list',
        name: 'chosen',
        message: 'Tipo de issue:',
        choices: available.map((t) => ({
          name: `${issueTypeIcon(t.name)}  ${t.name}`,
          value: t.name,
          short: t.name,
        })),
      }]);
      issueTypeName = chosen;
      const found = available.find((t) => t.name === chosen);
      if (found) {
        issueTypeId = found.id;
      }
    }
  }

  info(`Creando: "${summary}" [${issueTypeName}]`);

  let issue;
  try {
    const me = await jira.getMyself();
    issue = await jira.createIssue({
      projectKey: projectConfig.projectKey,
      summary,
      issueTypeName: issueTypeName!,
      issueTypeId,
      assigneeId: options.assign ?? projectConfig.defaultAssignee ?? me.accountId,
      estimateSeconds,
      dueDate,
      parentKey,
    });
  } catch (err: unknown) {
    error(`Error al crear el issue: ${(err as Error).message}`);
    process.exit(1);
  }

  success(`Creado ${chalk.bold(issue.key)}`);
  if (issue.estimateSkipped) info('La estimación no pudo guardarse (campo no habilitado en este proyecto).');
  if (parentKey) success(`Enlazado como hijo de ${chalk.bold(parentKey)}`);

  try {
    await transitionWithFallback(jira, issue.key, 'In Progress');
  } catch { /* no fatal */ }

  console.log(chalk.underline.blue(jira.getBrowseUrl(issue.key)));
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
