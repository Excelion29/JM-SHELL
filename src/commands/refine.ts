import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isTimeoutError, JiraService } from '../services/jira';
import { JiraAttachment, JiraIssue } from '../config/types';
import { requireAuth } from '../utils/auth';
import { resolveIssueKey } from '../utils/context';
import { adfToMarkdown } from '../utils/adf';
import { formatSeconds } from '../utils/time';
import { releaseStdin } from '../utils/terminal';
import { error, info, success, warn } from '../utils/format';
import { attachmentFileName, MAX_ATTACHMENT_BYTES } from '../refinement/attachments';
import {
  assertWorkDirUsable,
  handoffKnowledgeArgs,
  isClaudeAvailable,
  launchClaude,
  runClaude,
  workFilesOf,
} from '../refinement/claude';
import { loadPlan } from '../refinement/plan';
import { attachmentStoreName } from '../refinement/review';
import { planTotals } from '../refinement/pert';
import { installSkills } from '../refinement/skill';
import {
  advancePhase,
  assertKey,
  ATTACHMENTS_DIR,
  ensureStory,
  hasLogProgress,
  isValidIssueKey,
  PLAN_FILE,
  projectRoot,
  readState,
  STORY_FILE,
  updateState,
} from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import { workDirFor, WORK_ATTACHMENTS_DIR, writeReadOnlyCopy } from '../refinement/workdir';
import { refreshDashboard } from './dashboard';
import { applyKnowledgeFiles, KnowledgeRuntime, openKnowledge } from './knowledge-runtime';
import { openStory } from './story-resolver';

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
  store: StoryStore,
  key: string,
  attachments: JiraAttachment[],
  report: DownloadReport,
): Promise<void> {
  let oversize = 0;
  // Un solo listado de adjuntos: preguntar archivo por archivo sería una ida a la bóveda por cada uno
  const present = new Set((await store.list(ATTACHMENTS_DIR)).map((entry) => entry.name));
  const pending: Array<{ attachment: JiraAttachment; file: string; name: string }> = [];
  for (const attachment of attachments) {
    const file = attachmentFileName(attachment.id, attachment.filename);
    const name = `${ATTACHMENTS_DIR}/${file}`;
    if (present.has(file)) continue;
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      oversize += 1;
      continue;
    }
    pending.push({ attachment, file, name });
  }

  if (oversize > 0) report(oversizeSummary(oversize));

  const results: Downloaded[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const { attachment, file, name } = pending[next++];
      try {
        await store.writeBinary(name, await jira.downloadAttachmentBuffer(attachment.content, MAX_ATTACHMENT_BYTES));
        results.push({ file });
      } catch (err: unknown) {
        results.push({ file, error: err as Error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, pending.length) }, worker));

  const downloaded = results.flatMap((result) => (result.error ? [] : [result.file]));
  if (downloaded.length > 0) {
    await updateState(store, key, (s) => {
      for (const file of downloaded) {
        if (s.attachments.some((a) => a.file === file)) continue;
        s.attachments.push({ file, purpose: 'analysis', origin: 'jira', taskIds: [], uploaded: {} });
      }
    });
  }
  const failures = results.flatMap((result) => (result.error ? [result.error] : []));
  if (failures.length > 0) report(failureSummary(failures));
}

// Un nombre raro en la bóveda (puesto por otra persona) se omite: no debe impedir abrir la historia
function storeNameOrNull(file: string): string | null {
  try {
    return attachmentStoreName(file);
  } catch {
    return null;
  }
}

// Claude no abre binarios por el MCP: con la bóveda se deja una copia de solo lectura en la carpeta de trabajo
async function ensureReadOnlyCopies(store: StoryStore, workDir: string, key: string): Promise<void> {
  if (store.kind !== 'vault') return;
  const folder = path.join(WORK_ATTACHMENTS_DIR, key);
  const present = new Set(fs.existsSync(path.join(workDir, folder)) ? fs.readdirSync(path.join(workDir, folder)) : []);
  for (const entry of await store.list(ATTACHMENTS_DIR)) {
    if (!entry.isFile || present.has(entry.name)) continue;
    const name = storeNameOrNull(entry.name);
    if (name === null) continue;
    const data = await store.readBinary(name, MAX_ATTACHMENT_BYTES);
    if (data) writeReadOnlyCopy(workDir, folder, entry.name, data);
  }
}

export async function prepareStory(
  jira: JiraService,
  store: StoryStore,
  key: string,
  report: DownloadReport,
  workDir: string | null,
): Promise<void> {
  const issue = await jira.getIssueWithDescription(key);
  const attachments = await jira.getAttachments(key);
  await ensureStory(store, key, issue.fields.summary, issue.fields.parent?.key ?? null);
  await store.writeText(STORY_FILE, renderStoryDoc(issue, attachments));
  await downloadAttachments(jira, store, key, attachments, report);
  if (workDir !== null) await ensureReadOnlyCopies(store, workDir, key);
  await advancePhase(store, key, 'debate');
}

export async function ensureSkill(): Promise<void> {
  try {
    const results = await installSkills();
    for (const [name, result] of Object.entries(results)) {
      if (result === 'missing-asset') warn(`No encontré la skill /${name} dentro del paquete. Reinstala JM-SHELL.`);
    }
  } catch (err: unknown) {
    warn(`No pude instalar las skills de Claude: ${(err as Error).message}`);
  }
}

// El almacén de la bóveda no tiene fecha de modificación: un plan nuevo es uno cuyo contenido cambió en la sesión
async function planFingerprint(store: StoryStore): Promise<string | null> {
  const text = await store.readText(PLAN_FILE);
  return text === null ? null : createHash('sha256').update(text).digest('hex');
}

// `notice` va a la app; `printCli` es la salida por consola de `jm refinar --claude`, con su pista de comando
interface ClaudeOutcome {
  notice: string;
  printCli: () => void;
}

async function summarizeAfterClaude(
  store: StoryStore,
  key: string,
  planBefore: string | null,
): Promise<ClaudeOutcome> {
  const planAfter = await planFingerprint(store);
  if (planAfter === null || planAfter === planBefore) {
    return {
      notice: 'Quedaste en el debate.',
      printCli: () => info(`Quedaste en el debate. Siguiente paso: vuelve con \`jm refinar ${key}\` para continuar.`),
    };
  }
  try {
    const totals = planTotals(await loadPlan(store));
    await advancePhase(store, key, 'plan');
    const ready = `Plan listo: ${totals.taskCount} tarea(s), esperado ${formatSeconds(totals.expectedSeconds)}.`;
    return {
      notice: `${ready} Revisa el plan y decide qué tareas crear.`,
      printCli: () => {
        success(ready);
        info('Siguiente paso: revisa el plan y decide qué tareas crear.');
      },
    };
  } catch (err: unknown) {
    const invalid = `El plan.json no es válido todavía. ${(err as Error).message}`;
    return {
      notice: `${invalid} Pide a Claude que lo corrija.`,
      printCli: () => {
        warn(invalid);
        info(`Siguiente paso: vuelve con \`jm refinar ${key}\` y pide a Claude que lo corrija.`);
      },
    };
  }
}

interface SessionInput {
  root: string;
  key: string;
  store: StoryStore;
  workDir: string;
  knowledge: KnowledgeRuntime;
  sessionId: string | null;
}

async function runClaudeSession({ root, key, store, workDir, knowledge, sessionId }: SessionInput): Promise<ClaudeOutcome> {
  const planBefore = await planFingerprint(store);
  info('Abriendo Claude Code. Para volver a JM-SHELL escribe /exit o pulsa Ctrl+C dos veces.');
  releaseStdin();
  applyKnowledgeFiles(workDir, knowledge, key);
  await launchClaude({
    key,
    existingSessionId: sessionId,
    cwd: root,
    run: runClaude,
    extraArgs: handoffKnowledgeArgs(knowledge.kb, workFilesOf(workDir, key)),
    saveSessionId: async (id) => {
      await updateState(store, key, (s) => {
        s.claudeSessionId = id;
      });
    },
  });
  return summarizeAfterClaude(store, key, planBefore);
}

export interface RunRefineOptions {
  inApp?: boolean;
}

// Dentro de la app el resumen vuelve como aviso (la pantalla alterna ocultaría la consola); en la CLI se imprime
export async function runRefine(key: string, options: RunRefineOptions = {}): Promise<string> {
  assertKey(key);
  if (!isClaudeAvailable()) {
    throw new Error(`No encontré \`claude\` en tu terminal. ${CLAUDE_INSTALL_HINT}`);
  }
  const root = projectRoot();
  const jira = new JiraService(await requireAuth());
  const workDir = workDirFor(root);
  assertWorkDirUsable(workDir);

  info(`Preparando ${key}...`);
  const { store, notice: migrationNotice } = await openStory(root, key);
  if (migrationNotice && !options.inApp) info(migrationNotice);
  const state = await readState(store, key);
  // Antes de escribir nada: si la base no responde, no se toca la historia
  const knowledge = await openKnowledge({
    root,
    key,
    hasSession: Boolean(state?.claudeSessionId),
    hasLocalLog: await hasLogProgress(store, key),
  });
  try {
    await prepareStory(jira, store, key, warn, workDir);
    await ensureSkill();
    const sessionId = (await readState(store, key))?.claudeSessionId ?? null;
    const outcome = await runClaudeSession({ root, key, store, workDir, knowledge, sessionId });
    if (!options.inApp) outcome.printCli();
    return migrationNotice && options.inApp ? `${migrationNotice} ${outcome.notice}` : outcome.notice;
  } finally {
    await knowledge.close();
    try {
      await refreshDashboard(root);
    } catch (err: unknown) {
      warn(`No pude actualizar el inicio: ${(err as Error).message}`);
    }
  }
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
