import * as fs from 'fs-extra';
import { isTimeoutError, JiraService } from '../services/jira';
import { JiraAttachment, JiraIssue } from '../config/types';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { adfToMarkdown } from '../utils/adf';
import { formatSeconds } from '../utils/time';
import { releaseStdin } from '../utils/terminal';
import { error, info, success, warn } from '../utils/format';
import { attachmentFileName, MAX_ATTACHMENT_BYTES, resolveInside } from '../refinement/attachments';
import { handoffKnowledgeArgs, isClaudeAvailable, launchClaude, runClaude } from '../refinement/claude';
import { loadPlan } from '../refinement/plan';
import { planTotals } from '../refinement/pert';
import { installSkill } from '../refinement/skill';
import { assertNoLinks, lexists, safeWriteFile } from '../refinement/safe-fs';
import { applyKnowledgeFiles, openKnowledge } from './knowledge-runtime';
import {
  advancePhase,
  assertKey,
  attachmentsDir,
  ensureStory,
  isValidIssueKey,
  planPath,
  projectRoot,
  readState,
  renderDashboard,
  storyDocPath,
  updateState,
} from '../refinement/state';

const BYTES_PER_MB = 1024 * 1024;
const CLAUDE_INSTALL_HINT = 'Instálalo con `npm install -g @anthropic-ai/claude-code` y vuelve a intentar.';

function renderStoryDoc(issue: JiraIssue, attachments: JiraAttachment[]): string {
  const { fields } = issue;
  const parent = fields.parent ? `[${fields.parent.key}] ${fields.parent.fields.summary}` : '—';
  const description = adfToMarkdown(fields.description as Parameters<typeof adfToMarkdown>[0]);
  const files = attachments.length ? attachments.map((a) => `- ${a.filename}`) : ['_Sin adjuntos._'];
  return [
    `# [${issue.key}] ${fields.summary}`,
    '',
    `**Tipo:** ${fields.issuetype?.name ?? '—'} | **Estado:** ${fields.status.name}`,
    `**Padre:** ${parent}`,
    '',
    '## Descripción',
    '',
    description || '_Sin descripción._',
    '',
    '## Adjuntos',
    '',
    ...files,
    '',
  ].join('\n');
}

export type DownloadReport = (message: string) => void;

const DOWNLOAD_CONCURRENCY = 3;

interface Downloaded {
  file: string;
  error?: Error;
}

function oversizeSummary(count: number): string {
  const noun = count === 1 ? 'adjunto' : 'adjuntos';
  return `Omití ${count} ${noun} por tamaño (más de ${MAX_ATTACHMENT_BYTES / BYTES_PER_MB} MB). Descárgalos a mano si los necesitas.`;
}

function failureSummary(failures: Error[]): string {
  const timedOut = failures.every(isTimeoutError);
  const noun = failures.length === 1 ? 'adjunto' : 'adjuntos';
  const reason = timedOut ? 'tiempo de espera' : 'error';
  return `No pude descargar ${failures.length} ${noun} (${reason}). Siguen en Jira. Detalle: ${failures[0].message}`;
}

// El resumen sale por `report`: con la app (Ink) en pantalla un console.warn rompería el dibujo
async function downloadAttachments(
  jira: JiraService,
  root: string,
  key: string,
  attachments: JiraAttachment[],
  report: DownloadReport,
): Promise<void> {
  const dir = attachmentsDir(root, key);
  let oversize = 0;
  const pending: Array<{ attachment: JiraAttachment; file: string; dest: string }> = [];
  for (const attachment of attachments) {
    const file = attachmentFileName(attachment.id, attachment.filename);
    const dest = resolveInside(dir, file);
    assertNoLinks(root, dest);
    if (lexists(dest)) continue;
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      oversize += 1;
      continue;
    }
    pending.push({ attachment, file, dest });
  }

  if (oversize > 0) report(oversizeSummary(oversize));

  const results: Downloaded[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const { attachment, file, dest } = pending[next++];
      try {
        await jira.downloadAttachment(attachment.content, dest, MAX_ATTACHMENT_BYTES);
        results.push({ file });
      } catch (err: unknown) {
        results.push({ file, error: err as Error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, pending.length) }, worker));

  // El estado se escribe en serie: updateState relee y reescribe el mismo archivo
  for (const { file, error } of results) {
    if (error) continue;
    await updateState(root, key, (s) => {
      if (s.attachments.some((a) => a.file === file)) return;
      s.attachments.push({ file, purpose: 'analysis', origin: 'jira', taskIds: [], uploaded: {} });
    });
  }
  const failures = results.flatMap((result) => (result.error ? [result.error] : []));
  if (failures.length > 0) report(failureSummary(failures));
}

export async function prepareStory(
  jira: JiraService,
  root: string,
  key: string,
  report: DownloadReport = warn,
): Promise<void> {
  const issue = await jira.getIssueWithDescription(key);
  const attachments = await jira.getAttachments(key);
  await ensureStory(root, key, issue.fields.summary, issue.fields.parent?.key ?? null);
  safeWriteFile(root, storyDocPath(root, key), renderStoryDoc(issue, attachments));
  await downloadAttachments(jira, root, key, attachments, report);
  await advancePhase(root, key, 'debate');
}

export async function ensureSkill(): Promise<void> {
  try {
    const result = await installSkill();
    if (result === 'missing-asset') warn('No encontré la skill /refinar dentro del paquete. Reinstala JM-SHELL.');
  } catch (err: unknown) {
    warn(`No pude instalar la skill /refinar: ${(err as Error).message}`);
  }
}

// Un plan.json anterior a esta sesión (debate reabierto) no cuenta como plan nuevo
async function hasFreshPlan(planFile: string, sessionStartMs: number): Promise<boolean> {
  if (!(await fs.pathExists(planFile))) return false;
  return (await fs.stat(planFile)).mtimeMs >= sessionStartMs;
}

async function summarizeAfterClaude(root: string, key: string, sessionStartMs: number): Promise<void> {
  const planFile = planPath(root, key);
  if (!(await hasFreshPlan(planFile, sessionStartMs))) {
    info(`Quedaste en el debate. Siguiente paso: vuelve con \`jm refinar ${key}\` para continuar.`);
    return;
  }
  try {
    const totals = planTotals(await loadPlan(planFile));
    await advancePhase(root, key, 'plan');
    success(`Plan listo: ${totals.taskCount} tarea(s), esperado ${formatSeconds(totals.expectedSeconds)}.`);
    info('Siguiente paso: revisa el plan y decide qué tareas crear.');
  } catch (err: unknown) {
    warn(`El plan.json no es válido todavía. ${(err as Error).message}`);
    info(`Siguiente paso: vuelve con \`jm refinar ${key}\` y pide a Claude que lo corrija.`);
  }
}

async function runClaudeSession(root: string, key: string): Promise<void> {
  const state = await readState(root, key);
  const knowledge = await openKnowledge({ root, key, hasSession: Boolean(state?.claudeSessionId) });
  const sessionStartMs = Date.now();
  info('Abriendo Claude Code. Cuando termines, sal con /exit para volver aquí.');
  releaseStdin();
  try {
    applyKnowledgeFiles(root, knowledge);
    await launchClaude({
      key,
      existingSessionId: state?.claudeSessionId ?? null,
      cwd: root,
      run: runClaude,
      extraArgs: handoffKnowledgeArgs(knowledge.kb),
      saveSessionId: async (id) => {
        await updateState(root, key, (s) => {
          s.claudeSessionId = id;
        });
      },
    });
    await summarizeAfterClaude(root, key, sessionStartMs);
  } finally {
    await knowledge.close();
    await renderDashboard(root);
  }
}

export async function runRefine(key: string): Promise<void> {
  assertKey(key);
  if (!isClaudeAvailable()) {
    throw new Error(`No encontré \`claude\` en tu terminal. ${CLAUDE_INSTALL_HINT}`);
  }
  const root = projectRoot();
  const jira = new JiraService(await requireAuth());

  info(`Preparando ${key}...`);
  await prepareStory(jira, root, key);
  await renderDashboard(root);
  await ensureSkill();
  await runClaudeSession(root, key);
}

export interface RefineOptions {
  claude?: boolean;
}

export async function refineCommand(issueKeyArg?: string, options: RefineOptions = {}): Promise<void> {
  try {
    const key = await resolveIssueKey(issueKeyArg);
    if (!isValidIssueKey(key)) throw new Error(`Clave inválida: "${key}". Usa el formato AQ-45.`);
    if (options.claude) {
      await runRefine(key);
      return;
    }
    // Import dinámico: app.ts importa este módulo
    const { appCommand } = await import('./app.js');
    await appCommand({ chatKey: key });
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }
}
