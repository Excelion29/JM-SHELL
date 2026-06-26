import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { JiraService } from '../services/jira';
import { requireAuth } from '../utils/auth';
import { loadProjectConfig, loadContext } from '../config/loader';
import { adfToMarkdown } from '../utils/adf';
import { issueTypeIcon, error, info } from '../utils/format';
import { formatSeconds } from '../utils/time';

interface ExportOptions {
  out?: string;
  all?: boolean;
  type?: string;   // filtrar por tipo: Historia, Bug, Tarea, etc.
  jql?: string;    // JQL directo
}

export async function exportCommand(epicArg?: string, options: ExportOptions = {}): Promise<void> {
  const globalConfig = await requireAuth();
  const jira = new JiraService(globalConfig);

  let projectConfig;
  try {
    projectConfig = await loadProjectConfig();
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  const FIELDS = ['summary', 'status', 'assignee', 'description', 'issuetype', 'timeoriginalestimate', 'duedate', 'subtasks', 'parent'];

  // ── Modo JQL directo ──────────────────────────────────────────────────────
  if (options.jql) {
    info(`Buscando: ${options.jql}`);
    const issues = await searchSafe(jira, options.jql, FIELDS);
    if (!issues.length) { info('0 issues encontrados. Verifica tu JQL.'); return; }
    return writeIssues(issues, globalConfig.jiraUrl, options.out, 'jql-export.md');
  }

  // ── Modo --type: buscar por tipo en todo el proyecto (o en una épica) ─────
  if (options.type) {
    const epicClause = epicArg ? ` AND parent = ${epicArg.toUpperCase()}` : '';
    const jql = `project = ${projectConfig.projectKey}${epicClause} AND issuetype = "${options.type}" ORDER BY rank ASC`;
    info(`Buscando ${options.type}s: ${jql}`);
    const issues = await searchSafe(jira, jql, FIELDS);
    if (!issues.length) {
      info(`0 issues encontrados. El tipo exacto puede diferir — corre "jdf types" para ver los nombres reales.`);
      return;
    }
    const slug = options.type.toLowerCase().replace(/\s+/g, '-');
    return writeIssues(issues, globalConfig.jiraUrl, options.out, `${slug}s.export.md`);
  }

  // ── Modo épica(s): exportar jerarquía completa ────────────────────────────
  const epicKeys: string[] = [];

  if (options.all) {
    info('Buscando épicas...');
    const epics = await searchSafe(jira, `project = ${projectConfig.projectKey} AND issuetype = Epic ORDER BY rank ASC`);
    epicKeys.push(...epics.map(e => e.key));
  } else if (epicArg) {
    epicKeys.push(epicArg.toUpperCase());
  } else {
    const ctx = await loadContext();
    if (ctx) {
      if (ctx.issueType?.toLowerCase().includes('epic')) {
        epicKeys.push(ctx.issueKey);
      } else if (ctx.parentKey) {
        epicKeys.push(ctx.parentKey);
      } else {
        error('El contexto actual no es una épica. Usa: jdf export <CLAVE-EPICA> o jdf export --type <tipo>');
        process.exit(1);
      }
    } else {
      error('Sin argumento ni contexto. Ejemplos:\n  jdf export SFBI-6\n  jdf export --type Historia\n  jdf export --all');
      process.exit(1);
    }
  }

  if (!epicKeys.length) {
    info('No se encontraron épicas.');
    return;
  }

  const blocks: string[] = [];
  for (const epicKey of epicKeys) {
    info(`Exportando ${epicKey}...`);
    const block = await exportEpic(jira, epicKey, globalConfig.jiraUrl);
    if (block) blocks.push(block);
  }

  const output = blocks.join('\n\n---\n\n');
  const epicName = epicKeys.length === 1 ? epicKeys[0] : 'epicas';
  writeOutput(output, options.out, `${epicName}.export.md`);
}

async function exportEpic(jira: JiraService, epicKey: string, baseUrl: string): Promise<string | null> {
  // Obtener la épica con descripción
  let epic;
  try {
    epic = await jira.getIssueWithDescription(epicKey);
  } catch (err: unknown) {
    error(`Error al obtener ${epicKey}: ${(err as Error).message}`);
    return null;
  }

  // Obtener historias hijas con descripción
  let stories = await searchSafe(
    jira,
    `parent = ${epicKey} ORDER BY rank ASC`,
    ['summary', 'status', 'assignee', 'description', 'issuetype', 'timeoriginalestimate', 'duedate', 'subtasks']
  );

  // Fallback para proyectos classic
  if (!stories.length) {
    stories = await searchSafe(
      jira,
      `"Epic Link" = ${epicKey} ORDER BY rank ASC`,
      ['summary', 'status', 'assignee', 'description', 'issuetype', 'timeoriginalestimate', 'duedate', 'subtasks']
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const epicUrl = `${baseUrl}/browse/${epicKey}`;

  const lines: string[] = [
    '---',
    `fuente: "jira-export"`,
    `proyecto: "${epic.fields.summary.match(/EP-\d+/)?.[0] ?? epicKey}"`,
    `epica-clave: "${epicKey}"`,
    `epica-titulo: "${epic.fields.summary}"`,
    `issues: ${stories.length}`,
    `exportado: "${today}"`,
    '---',
    '',
    `# Épica: ${epic.fields.summary}`,
    `**Clave:** ${epicKey} | **Estado:** ${epic.fields.status.name}`,
    `**URL:** ${epicUrl}`,
  ];

  // Descripción de la épica (si tiene)
  const epicDesc = adfToMarkdown(epic.fields.description as Parameters<typeof adfToMarkdown>[0]);
  if (epicDesc) {
    lines.push('', '## Descripción de la épica', '', epicDesc);
  }

  if (!stories.length) {
    lines.push('', '_Sin issues asociados._');
    return lines.join('\n');
  }

  // Agrupar por tipo de issue
  const groups = new Map<string, typeof stories>();
  for (const issue of stories) {
    const type = issue.fields.issuetype?.name ?? 'Otro';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(issue);
  }

  lines.push('', `---`, '', `## Issues (${stories.length} total)`);

  for (const [type, issues] of groups) {
    const icon = issueTypeIcon(type);
    lines.push('', `### ${icon} ${type} (${issues.length})`);

    for (const issue of issues) {
      const { key, fields } = issue;
      const issueUrl = `${baseUrl}/browse/${key}`;
      const estimate = fields.timeoriginalestimate
        ? formatSeconds(fields.timeoriginalestimate)
        : '—';
      const assignee = fields.assignee?.displayName ?? 'Sin asignar';

      lines.push(
        '',
        `#### [${key}] ${fields.summary}`,
        `**Estado:** ${fields.status.name} | **Asignado:** ${assignee} | **Estimado:** ${estimate}`,
        `**URL:** ${issueUrl}`,
      );

      const desc = adfToMarkdown(fields.description as Parameters<typeof adfToMarkdown>[0]);
      if (desc) {
        lines.push('', desc);
      } else {
        lines.push('', '_Sin descripción._');
      }

      // Hijos directos (subtareas, bugs linkados, etc.)
      if (fields.subtasks?.length) {
        lines.push('', `**Hijos:**`);
        for (const sub of fields.subtasks) {
          lines.push(`- [${sub.key}] ${sub.fields.summary} — ${sub.fields.status.name}`);
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderSingleIssue(
  issue: Awaited<ReturnType<JiraService['searchIssues']>>[number],
  baseUrl: string
): string {
  const { key, fields } = issue;
  const today = new Date().toISOString().split('T')[0];
  const estimate = fields.timeoriginalestimate ? formatSeconds(fields.timeoriginalestimate) : '—';
  const assignee = fields.assignee?.displayName ?? 'Sin asignar';
  const epicKey  = fields.parent?.key ?? '';
  const epicTitle = fields.parent?.fields.summary ?? '';

  const lines: string[] = [
    '---',
    `fuente: "jira-export"`,
    `clave: "${key}"`,
    `tipo: "${fields.issuetype?.name ?? ''}"`,
    ...(epicKey ? [`epica: "${epicKey}"`, `epica-titulo: "${epicTitle}"`] : []),
    `estado: "${fields.status.name}"`,
    `asignado: "${assignee}"`,
    `estimado: "${estimate}"`,
    `exportado: "${today}"`,
    '---',
    '',
    `# [${key}] ${fields.summary}`,
    '',
    `**Estado:** ${fields.status.name} | **Asignado:** ${assignee} | **Estimado:** ${estimate}`,
    `**URL:** ${baseUrl}/browse/${key}`,
    ...(epicKey ? [`**Épica:** [${epicKey}] ${epicTitle}`] : []),
    '',
  ];

  const desc = adfToMarkdown(fields.description as Parameters<typeof adfToMarkdown>[0]);
  lines.push(desc || '_Sin descripción._', '');

  if (fields.subtasks?.length) {
    lines.push('## Hijos', '');
    for (const sub of fields.subtasks) {
      lines.push(`- [${sub.key}] ${sub.fields.summary} — ${sub.fields.status.name}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function writeIssues(
  issues: Awaited<ReturnType<JiraService['searchIssues']>>,
  baseUrl: string,
  outPath: string | undefined,
  defaultName: string
): void {
  const resolved = outPath ? path.resolve(outPath) : undefined;
  const isDir = resolved
    ? (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) || !path.extname(resolved)
    : false;

  if (resolved && isDir) {
    // Un archivo por issue
    fs.ensureDirSync(resolved);
    for (const issue of issues) {
      const content = renderSingleIssue(issue, baseUrl);
      const filePath = path.join(resolved, `${issue.key}.md`);
      fs.writeFileSync(filePath, content, 'utf8');
    }
    console.log(chalk.green(`✓`) + ` ${issues.length} archivo(s) exportado(s) → ${resolved}`);
  } else {
    // Todo en un archivo (o stdout)
    const combined = issues.map(i => renderSingleIssue(i, baseUrl)).join('\n---\n\n');
    writeOutput(combined, outPath ? path.join(path.dirname(resolved!), path.basename(resolved!)) : undefined, defaultName);
  }
}

function writeOutput(content: string, outPath?: string, defaultName = 'export.md'): void {
  if (!outPath) {
    console.log(content);
    return;
  }
  let resolved = path.resolve(outPath);
  // Si es un directorio existente, generar nombre de archivo dentro de él
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    resolved = path.join(resolved, defaultName);
  }
  fs.ensureDirSync(path.dirname(resolved));
  fs.writeFileSync(resolved, content, 'utf8');
  console.log(chalk.green(`✓`) + ` Exportado → ${resolved}`);
}

function renderFlatIssues(
  issues: Awaited<ReturnType<JiraService['searchIssues']>>,
  baseUrl: string,
  meta: { jql?: string; type?: string; epic?: string }
): string {
  const today = new Date().toISOString().split('T')[0];

  const lines: string[] = [
    '---',
    `fuente: "jira-export"`,
    ...(meta.type ? [`tipo: "${meta.type}"`] : []),
    ...(meta.epic ? [`epica: "${meta.epic}"`] : []),
    ...(meta.jql  ? [`jql: "${meta.jql}"`]   : []),
    `issues: ${issues.length}`,
    `exportado: "${today}"`,
    '---',
    '',
    meta.type
      ? `# Todos los "${meta.type}" ${meta.epic ? `en ${meta.epic}` : 'del proyecto'}`
      : `# Resultados JQL`,
    '',
    `Total: ${issues.length} issue(s)`,
    '',
    '---',
  ];

  // Agrupar por épica padre para dar contexto
  const byEpic = new Map<string, typeof issues>();
  for (const issue of issues) {
    const epicKey = issue.fields.parent?.key ?? '(sin épica)';
    if (!byEpic.has(epicKey)) byEpic.set(epicKey, []);
    byEpic.get(epicKey)!.push(issue);
  }

  for (const [epicKey, epicIssues] of byEpic) {
    const epicSummary = epicIssues[0]?.fields.parent?.fields.summary ?? '';
    lines.push('', `## ${epicKey}${epicSummary ? ` — ${epicSummary}` : ''}`, '');

    for (const issue of epicIssues) {
      const { key, fields } = issue;
      const icon = issueTypeIcon(fields.issuetype?.name ?? '');
      const issueUrl = `${baseUrl}/browse/${key}`;
      const estimate = fields.timeoriginalestimate ? formatSeconds(fields.timeoriginalestimate) : '—';
      const assignee = fields.assignee?.displayName ?? 'Sin asignar';

      lines.push(
        `### ${icon} [${key}] ${fields.summary}`,
        `**Estado:** ${fields.status.name} | **Tipo:** ${fields.issuetype?.name ?? '—'} | **Asignado:** ${assignee} | **Estimado:** ${estimate}`,
        `**URL:** ${issueUrl}`,
        '',
      );

      const desc = adfToMarkdown(fields.description as Parameters<typeof adfToMarkdown>[0]);
      lines.push(desc || '_Sin descripción._', '');

      if (fields.subtasks?.length) {
        lines.push('**Hijos:**');
        for (const sub of fields.subtasks) {
          lines.push(`- [${sub.key}] ${sub.fields.summary} — ${sub.fields.status.name}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

async function searchSafe(
  jira: JiraService,
  jql: string,
  fields?: string[]
) {
  try {
    return await jira.searchIssues(jql, fields);
  } catch (err: unknown) {
    error(`Error en búsqueda: ${(err as Error).message}`);
    return [];
  }
}
