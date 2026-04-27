import { loadProjectConfig, loadContext } from '../config/loader';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { formatIssueRow, issueTypeIcon, error, info } from '../utils/format';
import chalk from 'chalk';

interface ListOptions {
  mine?: boolean;
  status?: string;
  jql?: string;
}

export async function listCommand(parentArg?: string, options: ListOptions = {}): Promise<void> {
  const globalConfig = await requireAuth();

  let projectConfig;
  try {
    projectConfig = await loadProjectConfig();
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const jira = new JiraService(globalConfig);

  // ── Modo JQL directo ──────────────────────────────────────────
  if (options.jql) {
    await runSearch(jira, options.jql, globalConfig.jiraUrl, 'Resultados');
    return;
  }

  // ── Modo --mine ───────────────────────────────────────────────
  if (options.mine) {
    const statusClause = options.status ? ` AND status = "${options.status}"` : '';
    const jql = `project = ${projectConfig.projectKey} AND assignee = currentUser()${statusClause} ORDER BY updated DESC`;
    await runSearch(jira, jql, globalConfig.jiraUrl, 'Mis issues');
    return;
  }

  // ── Argumento directo: listar hijos del issue dado ────────────
  if (parentArg) {
    const key = parentArg.toUpperCase();
    await listChildren(jira, key, globalConfig.jiraUrl);
    return;
  }

  // ── Sin argumento: usar contexto o mostrar Épicas ─────────────
  const ctx = await loadContext();

  if (!ctx) {
    // Nivel raíz → mostrar Épicas
    await listEpics(jira, projectConfig.projectKey, globalConfig.jiraUrl, options.status);
    return;
  }

  // Hay contexto → listar hijos del issue actual
  const icon = issueTypeIcon(ctx.issueType ?? '');
  console.log(chalk.dim(`\n  Dentro de: ${icon} ${chalk.bold(ctx.issueKey)} — ${ctx.summary ?? ''}`));
  if (ctx.parentKey) {
    console.log(chalk.dim(`  (usa ${chalk.cyan('jdf up')} para volver a [${ctx.parentKey}])`));
  } else {
    console.log(chalk.dim(`  (usa ${chalk.cyan('jdf up')} para volver a las Épicas)`));
  }

  await listChildren(jira, ctx.issueKey, globalConfig.jiraUrl, options.status);
}

async function listEpics(jira: JiraService, projectKey: string, baseUrl: string, status?: string): Promise<void> {
  const statusClause = status ? ` AND status = "${status}"` : '';
  const jql = `project = ${projectKey} AND issuetype = Epic${statusClause} ORDER BY rank ASC`;

  console.log(chalk.bold.magenta('\n  ⬡ Épicas del proyecto\n'));
  console.log(chalk.dim(`  Tip: usa ${chalk.cyan('jdf use <CLAVE>')} para entrar a una épica y ver su contenido.\n`));

  await runSearch(jira, jql, baseUrl, null);
}

async function listChildren(jira: JiraService, parentKey: string, baseUrl: string, status?: string): Promise<void> {
  const statusClause = status ? ` AND status = "${status}"` : '';

  // Jira Cloud next-gen y classic usan parent = KEY para hijos directos
  // Para stories bajo épicas en proyectos classic se usa "Epic Link"
  let issues = await searchSafe(jira, `parent = ${parentKey}${statusClause} ORDER BY rank ASC`);

  // Fallback para proyectos classic donde las stories están bajo épicas con "Epic Link"
  if (issues.length === 0) {
    issues = await searchSafe(jira, `"Epic Link" = ${parentKey}${statusClause} ORDER BY rank ASC`);
  }

  if (issues.length === 0) {
    info('No se encontraron issues en este nivel.');
    console.log(chalk.dim(`  Tip: usa ${chalk.cyan('jdf up')} para subir un nivel.\n`));
    return;
  }

  // Agrupar por tipo
  const groups = new Map<string, typeof issues>();
  for (const issue of issues) {
    const type = issue.fields.issuetype?.name ?? 'Otro';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(issue);
  }

  const total = issues.length;
  console.log(chalk.bold(`\n  ${total} issue(s):\n`));

  for (const [type, items] of groups) {
    const icon = issueTypeIcon(type);
    console.log(chalk.bold(`  ${icon} ${type} (${items.length})\n`));
    for (const issue of items) {
      const row = formatIssueRow(
        { key: issue.key, summary: issue.fields.summary, status: issue.fields.status.name, issueType: type },
        baseUrl
      );
      // Indentar cada línea del row
      console.log(row.split('\n').map(l => '  ' + l).join('\n'));
    }
  }
}

async function runSearch(jira: JiraService, jql: string, baseUrl: string, title: string | null): Promise<void> {
  const issues = await searchSafe(jira, jql);

  if (issues.length === 0) {
    info('No se encontraron issues.');
    return;
  }

  if (title) console.log(chalk.bold(`\n  ${title} — ${issues.length} issue(s):\n`));
  else console.log();

  for (const issue of issues) {
    const row = formatIssueRow(
      {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        issueType: issue.fields.issuetype?.name,
      },
      baseUrl
    );
    console.log(row.split('\n').map(l => '  ' + l).join('\n'));
  }
}

async function searchSafe(jira: JiraService, jql: string) {
  try {
    return await jira.searchIssues(jql);
  } catch (err: unknown) {
    error(`Error en búsqueda: ${(err as Error).message}`);
    process.exit(1);
  }
}
