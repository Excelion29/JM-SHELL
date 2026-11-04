import * as fs from 'fs-extra';
import { JiraService } from '../services/jira';
import { JiraAttachment, JiraIssue } from '../config/types';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { adfToMarkdown } from '../utils/adf';
import { formatSeconds } from '../utils/time';
import { error, info, success, warn } from '../utils/format';
import { attachmentFileName, MAX_ATTACHMENT_BYTES, resolveInside } from '../refinement/attachments';
import { isClaudeAvailable, launchClaude, runClaude } from '../refinement/claude';
import { loadPlan } from '../refinement/plan';
import { planTotals } from '../refinement/pert';
import { installSkill } from '../refinement/skill';
import { assertNoLinks, lexists, safeWriteFile } from '../refinement/safe-fs';
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

async function downloadAttachments(
  jira: JiraService,
  root: string,
  key: string,
  attachments: JiraAttachment[],
): Promise<void> {
  const dir = attachmentsDir(root, key);
  for (const attachment of attachments) {
    const file = attachmentFileName(attachment.id, attachment.filename);
    const dest = resolveInside(dir, file);
    assertNoLinks(root, dest);
    if (lexists(dest)) continue;
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      warn(`Omito ${file}: pesa más de ${MAX_ATTACHMENT_BYTES / BYTES_PER_MB} MB. Descárgalo a mano si lo necesitas.`);
      continue;
    }
    try {
      await jira.downloadAttachment(attachment.content, dest, MAX_ATTACHMENT_BYTES);
    } catch (err: unknown) {
      warn(`No pude descargar ${file}: ${(err as Error).message}`);
      continue;
    }
    await updateState(root, key, (s) => {
      if (s.attachments.some((a) => a.file === file)) return;
      s.attachments.push({ file, purpose: 'analysis', origin: 'jira', taskIds: [], uploaded: {} });
    });
  }
}

async function prepareStory(jira: JiraService, root: string, key: string): Promise<void> {
  const issue = await jira.getIssueWithDescription(key);
  const attachments = await jira.getAttachments(key);
  await ensureStory(root, key, issue.fields.summary, issue.fields.parent?.key ?? null);
  safeWriteFile(root, storyDocPath(root, key), renderStoryDoc(issue, attachments));
  await downloadAttachments(jira, root, key, attachments);
  await advancePhase(root, key, 'debate');
}

async function ensureSkill(): Promise<void> {
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
  const sessionStartMs = Date.now();
  info('Abriendo Claude Code. Cuando termines, sal con /exit para volver aquí.');
  try {
    await launchClaude({
      key,
      existingSessionId: state?.claudeSessionId ?? null,
      cwd: root,
      run: runClaude,
      saveSessionId: async (id) => {
        await updateState(root, key, (s) => {
          s.claudeSessionId = id;
        });
      },
    });
    await summarizeAfterClaude(root, key, sessionStartMs);
  } finally {
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

export async function refineCommand(issueKeyArg?: string): Promise<void> {
  try {
    const key = await resolveIssueKey(issueKeyArg);
    if (!isValidIssueKey(key)) throw new Error(`Clave inválida: "${key}". Usa el formato AQ-45.`);
    await runRefine(key);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }
}
