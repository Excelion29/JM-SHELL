import * as fs from 'fs-extra';
import * as path from 'path';
import { findFileUpward } from '../config/loader';
import { warn } from '../utils/format';
import { sanitizeFilename } from './attachments';
import { assertNoLinks, JM_DIR, lexists, safeEnsureDir, safeWriteFile } from './safe-fs';
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
} from './types';

const PROJECT_CONFIG_NAME = '.jira.json';
const STORIES_DIR = 'historias';
const ATTACHMENTS_DIR = 'adjuntos';
const STATE_FILE = 'estado.json';
const PLAN_FILE = 'plan.json';
const STORY_FILE = 'historia.md';
const LOG_FILE = 'bitacora.md';
const DASHBOARD_FILE = 'INICIO.md';
// Mismo formato que ISSUE_KEY_PATTERN en src/tui/texts.ts
const ISSUE_KEY_STRICT = /^[A-Z][A-Z0-9]+-\d+$/;
const NO_BLOCK_LABEL = '—';

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

export const storyDir = (root: string, key: string) => path.join(root, JM_DIR, STORIES_DIR, key);
export const statePath = (root: string, key: string) => path.join(storyDir(root, key), STATE_FILE);
export const planPath = (root: string, key: string) => path.join(storyDir(root, key), PLAN_FILE);
export const storyDocPath = (root: string, key: string) => path.join(storyDir(root, key), STORY_FILE);
export const logPath = (root: string, key: string) => path.join(storyDir(root, key), LOG_FILE);
export const attachmentsDir = (root: string, key: string) => path.join(storyDir(root, key), ATTACHMENTS_DIR);
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
        uploaded: readStringMap(item.uploaded),
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
  if (raw.block !== undefined && raw.block !== null) warn(`Bloque desconocido "${stripControlChars(String(raw.block))}" en ${file}.`);
  return null;
}

// Un id con formato raro nunca llega a un proceso: se descarta aquí y de nuevo antes de lanzar claude
const readSessionId = (value: unknown): string | null =>
  typeof value === 'string' && SESSION_ID_PATTERN.test(value) ? value : null;

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
    createdIssues: readStringMap(raw.createdIssues),
    attachments: readAttachments(raw.attachments),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

async function hasLogProgress(root: string, key: string): Promise<boolean> {
  const file = logPath(root, key);
  if (!lexists(file)) return false;
  assertNoLinks(root, file);
  return (await fs.readFile(file, 'utf8')).trim() !== `# Bitácora ${key}`;
}

export async function readState(root: string, key: string): Promise<StoryState | null> {
  assertKey(key);
  const file = statePath(root, key);
  if (!lexists(file)) return null;
  try {
    assertNoLinks(root, file);
    return normalize(await fs.readJson(file), key, file, await hasLogProgress(root, key));
  } catch (err: unknown) {
    throw new Error(`No pude leer ${file}: ${(err as Error).message}`);
  }
}

async function writeState(root: string, state: StoryState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  safeWriteFile(root, statePath(root, state.key), `${JSON.stringify(state, null, 2)}
`);
}

// Lee de disco justo antes de escribir: la skill también edita estado.json (fase/bloque)
export async function updateState(root: string, key: string, mutate: (state: StoryState) => void): Promise<StoryState> {
  const current = await readState(root, key);
  if (!current) throw new Error(`La historia ${key} aún no tiene estado. Ejecuta \`jm refinar ${key}\`.`);
  mutate(current);
  await writeState(root, current);
  return current;
}

export async function ensureStory(
  root: string,
  key: string,
  summary: string,
  parentKey: string | null,
): Promise<StoryState> {
  assertKey(key);
  safeEnsureDir(root, attachmentsDir(root, key));
  if (!lexists(logPath(root, key))) {
    safeWriteFile(root, logPath(root, key), `# Bitácora ${key}\n\n`);
  }
  const existing = await readState(root, key);
  if (existing) {
    return updateState(root, key, (s) => {
      s.summary = summary;
      s.parentKey = parentKey;
    });
  }
  const state = normalize({ summary, parentKey }, key, statePath(root, key), false);
  await writeState(root, state);
  return state;
}

export async function transitionPhase(
  root: string,
  key: string,
  to: Phase,
  options: { reopen?: boolean } = {},
): Promise<StoryState> {
  return updateState(root, key, (s) => {
    if (PHASES.indexOf(to) < PHASES.indexOf(s.phase) && !options.reopen) {
      throw new Error(`No se puede pasar de "${s.phase}" a "${to}" sin reabrir la historia.`);
    }
    s.phase = to;
  });
}

// Avanza solo si el destino está por delante: nunca pisa un avance que hizo la skill
export async function advancePhase(root: string, key: string, to: Phase): Promise<StoryState> {
  return updateState(root, key, (s) => {
    if (PHASES.indexOf(to) > PHASES.indexOf(s.phase)) s.phase = to;
  });
}

const UNREADABLE_STATE_EPOCH = new Date(0).toISOString();

function unreadableStory(key: string): StoryState {
  return {
    key,
    summary: `estado ilegible, revisa .jm/${STORIES_DIR}/${key}/${STATE_FILE}`,
    phase: 'spec',
    block: null,
    claudeSessionId: null,
    parentKey: null,
    createdIssues: {},
    attachments: [],
    updatedAt: UNREADABLE_STATE_EPOCH,
  };
}

// Un estado.json roto no debe tumbar el inicio: aparece como historia con aviso
async function readStateOrPlaceholder(root: string, key: string): Promise<StoryState | null> {
  try {
    return await readState(root, key);
  } catch {
    return unreadableStory(key);
  }
}

export async function listStories(root: string): Promise<StoryState[]> {
  const base = path.join(root, JM_DIR, STORIES_DIR);
  if (!(await fs.pathExists(base))) return [];
  const keys = (await fs.readdir(base)).filter(isValidIssueKey);
  const states = await Promise.all(keys.map((key) => readStateOrPlaceholder(root, key)));
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
    block: state.block ? BLOCK_LABELS[state.block] : NO_BLOCK_LABEL,
    nextStep: nextStepFor(state),
    updatedAt: state.updatedAt,
  };
}

const escapeCell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

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

export async function renderDashboard(root: string): Promise<void> {
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, dashboardPath(root), renderDashboardMarkdown(await listStories(root)));
}
