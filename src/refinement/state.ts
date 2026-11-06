import * as fs from 'fs-extra';
import * as path from 'path';
import { findFileUpward } from '../config/loader';
import { warn } from '../utils/format';
import { sanitizeFilename } from './attachments';
import { assertNoLinks, JM_DIR, lexists, safeEnsureDir, safeWriteFile } from './safe-fs';
import type { StoryStore } from './story-store';
import { stripControlChars } from './text';
import { SESSION_ID_PATTERN } from './claude';
import {
  ATTACHMENT_PURPOSES,
  AttachmentPurpose,
  Block,
  BLOCKS,
  Phase,
  PHASES,
  StoryAttachment,
  StoryState,
  StorySummary,
  StoryUsage,
  TaskRun,
} from './types';

const PROJECT_CONFIG_NAME = '.jira.json';
export const STORIES_DIR = 'historias';
export const ATTACHMENTS_DIR = 'adjuntos';
export const STATE_FILE = 'estado.json';
export const PLAN_FILE = 'plan.json';
export const STORY_FILE = 'historia.md';
export const LOG_FILE = 'bitacora.md';
const DASHBOARD_FILE = 'INICIO.md';
const GITIGNORE_FILE = '.gitignore';
export const CHAT_FILE = 'conversacion.jsonl';
// Nombre anterior: el proxy y Obsidian rechazan los archivos con punto inicial
export const LEGACY_CHAT_FILE = '.chat.jsonl';
// Adjuntos temporales y copia local del chat: nada de esto va al repositorio
const GITIGNORE_LINES = [
  `${STORIES_DIR}/*/${ATTACHMENTS_DIR}/`,
  `${STORIES_DIR}/*/${CHAT_FILE}`,
  `${STORIES_DIR}/*/${LEGACY_CHAT_FILE}`,
];
// Mismo formato que ISSUE_KEY_PATTERN en src/tui/texts.ts
const ISSUE_KEY_STRICT = /^[A-Z][A-Z0-9_]+-\d+$/;
const NO_BLOCK_LABEL = '—';
const MAX_CELL_LENGTH = 200;
const ELLIPSIS = '…';
// Obsidian interpreta enlaces, incrustaciones y HTML dentro de las celdas: se neutralizan todos
const MARKDOWN_SPECIALS = /[\\|[\]!<>`]/g;

export const PHASE_LABELS: Record<Phase, string> = {
  spec: 'especificación',
  debate: 'debate',
  plan: 'plan',
  reviewed: 'revisado',
  created: 'creada',
  'in-progress': 'en curso',
  closed: 'cerrada',
};

export const BLOCK_LABELS: Record<Block, string> = {
  scope: 'alcance',
  dependencies: 'dependencias',
  risks: 'riesgos',
  'done-criteria': 'criterio de terminado',
  tasks: 'tareas',
  estimation: 'estimación',
};

export function isValidIssueKey(key: string): boolean {
  return ISSUE_KEY_STRICT.test(key);
}

export function projectRoot(): string {
  const config = findFileUpward(PROJECT_CONFIG_NAME);
  return config ? path.dirname(config) : process.cwd();
}

export const dashboardPath = (root: string) => path.join(root, JM_DIR, DASHBOARD_FILE);

export function assertKey(key: string): void {
  if (!isValidIssueKey(key)) throw new Error(`Clave de historia inválida: "${key}". Usa el formato AQ-45.`);
}

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

function readStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

// Las claves que llegan de estado.json terminan en rutas REST: las inválidas se descartan
function readKeyMap(value: unknown, keysAreIssues: boolean): Record<string, string> {
  return Object.fromEntries(
    Object.entries(readStringMap(value)).filter(([k, v]) => isValidIssueKey(keysAreIssues ? k : v)),
  );
}

function readAttachments(value: unknown): StoryAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) => {
    const { file, purpose, origin, taskIds } = item;
    const valid =
      typeof file === 'string' &&
      file === sanitizeFilename(file) &&
      !file.includes(':') &&
      ATTACHMENT_PURPOSES.includes(purpose as AttachmentPurpose) &&
      (origin === 'jira' || origin === 'local');
    if (!valid) return [];
    return [
      {
        file,
        purpose: purpose as AttachmentPurpose,
        origin,
        taskIds: isStringList(taskIds) ? taskIds : [],
        uploaded: readKeyMap(item.uploaded, true),
      },
    ];
  });
}

function readPhase(raw: RawRecord, file: string, progressed: boolean): Phase {
  if (PHASES.includes(raw.phase as Phase)) return raw.phase as Phase;
  if (raw.phase !== undefined) warn(`Fase desconocida "${stripControlChars(String(raw.phase))}" en ${file}.`);
  return progressed ? 'debate' : 'spec';
}

function readBlock(raw: RawRecord, file: string): Block | null {
  if (BLOCKS.includes(raw.block as Block)) return raw.block as Block;
  if (raw.block !== undefined && raw.block !== null)
    warn(`Bloque desconocido "${stripControlChars(String(raw.block))}" en ${file}.`);
  return null;
}

// Un id con formato raro nunca llega a un proceso: se descarta aquí y de nuevo antes de lanzar claude
const readSessionId = (value: unknown): string | null =>
  typeof value === 'string' && SESSION_ID_PATTERN.test(value) ? value : null;

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const readTimestamp = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;

function readTaskRuns(value: unknown): Record<string, TaskRun> {
  if (!isRecord(value)) return {};
  const runs: Record<string, TaskRun> = {};
  for (const [issueKey, raw] of Object.entries(value)) {
    const startedAt = isRecord(raw) ? readTimestamp(raw.startedAt) : null;
    if (!isRecord(raw) || !isValidIssueKey(issueKey) || startedAt === null) continue;
    runs[issueKey] = {
      issueKey,
      claudeSessionId: readSessionId(raw.claudeSessionId),
      startedAt,
      finishedAt: readTimestamp(raw.finishedAt),
      activeMs: readCount(raw.activeMs),
      status: raw.status === 'done' ? 'done' : 'started',
      ...(raw.pendingDone === true ? { pendingDone: true } : {}),
    };
  }
  return runs;
}

export const emptyUsage = (): StoryUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  turns: 0,
});

function readUsage(value: unknown): StoryUsage {
  if (!isRecord(value)) return emptyUsage();
  return {
    inputTokens: readCount(value.inputTokens),
    outputTokens: readCount(value.outputTokens),
    cacheReadTokens: readCount(value.cacheReadTokens),
    costUsd: readCount(value.costUsd),
    turns: readCount(value.turns),
  };
}

// La clave sale siempre de la carpeta/argumento validado, nunca del contenido del archivo
function normalize(raw: unknown, key: string, file: string, progressed: boolean): StoryState {
  if (!isRecord(raw)) throw new Error('el contenido no es un objeto JSON');
  const block = readBlock(raw, file);
  return {
    key,
    summary: typeof raw.summary === 'string' ? stripControlChars(raw.summary) : '',
    phase: readPhase(raw, file, progressed || block !== null),
    block,
    claudeSessionId: readSessionId(raw.claudeSessionId),
    parentKey: typeof raw.parentKey === 'string' ? raw.parentKey : null,
    createdIssues: readKeyMap(raw.createdIssues, false),
    taskRuns: readTaskRuns(raw.taskRuns),
    attachments: readAttachments(raw.attachments),
    usage: readUsage(raw.usage),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

export async function hasLogProgress(store: StoryStore, key: string): Promise<boolean> {
  const log = await store.readText(LOG_FILE);
  return log !== null && log.trim() !== `# Bitácora ${key}`;
}

export async function readState(store: StoryStore, key: string): Promise<StoryState | null> {
  assertKey(key);
  const file = `${store.label}/${STATE_FILE}`;
  try {
    const text = await store.readText(STATE_FILE);
    if (text === null) return null;
    const raw: unknown = JSON.parse(text);
    // La bitácora solo hace falta para deducir la fase de un estado.json que no la trae
    const phaseKnown = isRecord(raw) && PHASES.includes(raw.phase as Phase);
    return normalize(raw, key, file, !phaseKnown && (await hasLogProgress(store, key)));
  } catch (err: unknown) {
    throw new Error(`No pude leer ${file}: ${(err as Error).message}`);
  }
}

// El índice de la base solo se rehace cuando cambia algo que muestra
const indexSignature = (state: StoryState) =>
  `${state.phase}|${state.summary}|${Object.keys(state.createdIssues).length}`;

async function writeState(store: StoryStore, state: StoryState, previous: StoryState | null): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await store.writeText(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  if (previous && indexSignature(previous) === indexSignature(state)) return;
  try {
    await store.onStoryChanged?.(state);
  } catch (err: unknown) {
    warn(`No pude actualizar el índice de la base: ${(err as Error).message}`);
  }
}

// Lee justo antes de escribir: la skill también edita estado.json (fase/bloque)
export async function updateState(
  store: StoryStore,
  key: string,
  mutate: (state: StoryState) => void,
): Promise<StoryState> {
  const current = await readState(store, key);
  if (!current) throw new Error(`La historia ${key} aún no tiene estado. Ejecuta \`jm refinar ${key}\`.`);
  const previous = structuredClone(current);
  mutate(current);
  // Sin cambios no se reescribe: ahorra una escritura (y una ida a la bóveda) por cada guardado repetido
  if (JSON.stringify(current) === JSON.stringify(previous)) return current;
  await writeState(store, current, previous);
  return current;
}

// Agrega las líneas que falten sin pisar lo que el dev ya puso
export function ensureJmGitignore(root: string): void {
  const jmDir = path.join(root, JM_DIR);
  safeEnsureDir(root, jmDir);
  const file = path.join(jmDir, GITIGNORE_FILE);
  if (lexists(file)) assertNoLinks(root, file);
  const current = lexists(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (!missing.length) return;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  safeWriteFile(root, file, `${current}${separator}${missing.join('\n')}\n`);
}

export async function ensureStory(
  store: StoryStore,
  key: string,
  summary: string,
  parentKey: string | null,
): Promise<StoryState> {
  assertKey(key);
  await store.ensureReady();
  if (!(await store.exists(LOG_FILE))) await store.writeText(LOG_FILE, `# Bitácora ${key}\n\n`);
  const existing = await readState(store, key);
  if (existing) {
    return updateState(store, key, (s) => {
      s.summary = summary;
      s.parentKey = parentKey;
    });
  }
  const state = normalize({ summary, parentKey }, key, STATE_FILE, false);
  await writeState(store, state, null);
  return state;
}

export async function transitionPhase(
  store: StoryStore,
  key: string,
  to: Phase,
  options: { reopen?: boolean } = {},
): Promise<StoryState> {
  return updateState(store, key, (s) => {
    if (PHASES.indexOf(to) < PHASES.indexOf(s.phase) && !options.reopen) {
      throw new Error(`No se puede pasar de "${s.phase}" a "${to}" sin reabrir la historia.`);
    }
    s.phase = to;
  });
}

// Avanza solo si el destino está por delante: nunca pisa un avance que hizo la skill
export async function advancePhase(store: StoryStore, key: string, to: Phase): Promise<StoryState> {
  return updateState(store, key, (s) => {
    if (PHASES.indexOf(to) > PHASES.indexOf(s.phase)) s.phase = to;
  });
}

const UNREADABLE_STATE_EPOCH = new Date(0).toISOString();

function unreadableStory(key: string, location: string): StoryState {
  return {
    key,
    summary: `estado ilegible, revisa ${location}/${STATE_FILE}`,
    phase: 'spec',
    block: null,
    claudeSessionId: null,
    parentKey: null,
    createdIssues: {},
    taskRuns: {},
    attachments: [],
    usage: emptyUsage(),
    updatedAt: UNREADABLE_STATE_EPOCH,
  };
}

// Un estado.json roto no debe tumbar el inicio: aparece como historia con aviso
async function readStateOrPlaceholder(store: StoryStore, key: string): Promise<StoryState | null> {
  try {
    return await readState(store, key);
  } catch {
    return unreadableStory(key, store.label);
  }
}

export async function listStoriesFrom(stores: Array<{ key: string; store: StoryStore }>): Promise<StoryState[]> {
  const states = await Promise.all(stores.map(({ key, store }) => readStateOrPlaceholder(store, key)));
  return states.filter((s): s is StoryState => s !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const NEXT_STEPS: Record<Phase, (key: string) => string> = {
  spec: (key) => `Ejecuta \`jm refinar ${key}\` para empezar el debate.`,
  debate: (key) => `Continúa el debate con \`jm refinar ${key}\`.`,
  plan: () => 'Revisa el plan y decide qué tareas crear.',
  reviewed: () => 'Crea las tareas marcadas en Jira.',
  created: () => 'Empieza con la primera tarea creada.',
  'in-progress': () => 'Sigue con las tareas pendientes.',
  closed: () => 'Historia cerrada. Nada pendiente.',
};

export function nextStepFor(state: StoryState): string {
  if (state.phase === 'debate' && state.block) {
    return `Retoma el debate en ${BLOCK_LABELS[state.block]} con \`jm refinar ${state.key}\`.`;
  }
  return NEXT_STEPS[state.phase](state.key);
}

export function toSummary(state: StoryState): StorySummary {
  return {
    key: state.key,
    summary: state.summary,
    phase: PHASE_LABELS[state.phase],
    phaseId: state.phase,
    block: state.block ? BLOCK_LABELS[state.block] : NO_BLOCK_LABEL,
    nextStep: nextStepFor(state),
    updatedAt: state.updatedAt,
  };
}

// Texto de una celda de tabla Markdown: una sola línea, acotada y sin sintaxis activa
export const escapeCell = (text: string): string => {
  const flat = text.replace(/\r?\n/g, ' ');
  const capped = flat.length > MAX_CELL_LENGTH ? `${flat.slice(0, MAX_CELL_LENGTH)}${ELLIPSIS}` : flat;
  return capped.replace(MARKDOWN_SPECIALS, '\\$&');
};

export function renderDashboardMarkdown(stories: StoryState[]): string {
  const lines = ['# Donde te quedaste', ''];
  if (!stories.length) {
    lines.push('Aún no hay historias en refinamiento.', '', 'Siguiente paso: ejecuta `jm refinar <CLAVE>`.', '');
    return lines.join('\n');
  }
  lines.push('| Clave | Resumen | Fase | Bloque | Siguiente paso | Actualizado |', '|---|---|---|---|---|---|');
  for (const story of stories) {
    const s = toSummary(story);
    const cells = [s.key, s.summary, s.phase, s.block, s.nextStep, s.updatedAt].map(escapeCell);
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}
