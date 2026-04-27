import inquirer from 'inquirer';
import { loadProjectConfig, loadContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { parseTime } from '../utils/time';
import { success, error, info, issueTypeIcon } from '../utils/format';
import { transitionWithFallback } from '../utils/transition';
import chalk from 'chalk';

interface DoOptions {
  due?: string;
  estimate?: string;
  parent?: string;
  assign?: string;
  type?: string;
}

// Tipos que NO se ofrecen como opción al crear (son contenedores o internos)
const EXCLUDED_TYPES = ['epic', 'épica', 'epica'];

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

  // ── Resolver contexto como padre automático ───────────────────
  let parentKey = options.parent;
  if (!parentKey) {
    const ctx = await loadContext();
    if (ctx) {
      parentKey = ctx.issueKey;
      info(`Creando dentro de: ${issueTypeIcon(ctx.issueType ?? '')} ${chalk.bold(ctx.issueKey)} — ${ctx.summary}`);
    }
  }

  // ── Elegir tipo de issue según jerarquía actual ───────────────
  let issueTypeName = options.type;
  if (!issueTypeName) {
    let types: Array<{ id: string; name: string; subtask: boolean }> = [];
    try {
      types = await jira.getIssueTypes(projectConfig.projectKey);
    } catch {
      // Si falla la consulta, seguir con lista vacía
    }

    const ctx = await loadContext();
    const ctxType = ctx?.issueType?.toLowerCase() ?? '';
    const isInsideSubtask = ctx && (ctxType.includes('subtask') || ctxType.includes('subtarea'));
    const isInsideEpicOrRoot = !ctx || ctxType.includes('epic') || ctxType.includes('épica') || ctxType.includes('epica');

    if (isInsideSubtask) {
      error(`No se pueden crear issues dentro de una subtarea (${ctx!.issueKey}).`);
      info(`Usa ${chalk.cyan('jdf up')} para subir al nivel correcto.`);
      process.exit(1);
    }

    let available: typeof types;

    if (isInsideEpicOrRoot) {
      // Dentro de épica o en raíz → solo tipos que NO son subtarea ni épica
      available = types.filter((t) => {
        const lower = t.name.toLowerCase();
        return !t.subtask && !EXCLUDED_TYPES.some((ex) => lower.includes(ex));
      });
    } else {
      // Dentro de Historia/Tarea/Bug → solo subtareas
      available = types.filter((t) => t.subtask);
    }

    if (available.length === 0) {
      issueTypeName = isInsideEpicOrRoot ? 'Task' : 'Subtask';
    } else if (available.length === 1) {
      issueTypeName = available[0].name;
    } else {
      const { chosen } = await inquirer.prompt([
        {
          type: 'list',
          name: 'chosen',
          message: 'Tipo de issue:',
          choices: available.map((t) => ({
            name: `${issueTypeIcon(t.name)}  ${t.name}`,
            value: t.name,
            short: t.name,
          })),
        },
      ]);
      issueTypeName = chosen;
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
  if (issue.estimateSkipped) {
    info('La estimación no pudo guardarse (campo no habilitado en este proyecto).');
  }
  if (parentKey) {
    success(`Enlazado como hijo de ${chalk.bold(parentKey)}`);
  }

  try {
    await transitionWithFallback(jira, issue.key, 'In Progress');
  } catch {
    // No es fatal si la transición no existe
  }

  console.log(chalk.underline.blue(jira.getBrowseUrl(issue.key)));
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
