// Análisis sin historia (parte 10B-1): un tipo propio con id local `an-<n>`, nunca una clave de Jira
import {
  ANALYSIS_DIR_NAME,
  ANALYSIS_KEY_SOURCE,
  ANALYSIS_STATE_NAME,
  POINT_ID_SOURCE,
  SESSION_ID_PATTERN,
} from './claude';
import { readReferencedNotes } from './referenced-notes';
import { emptyUsage, isValidIssueKey, readPlanningTasks, readTaskRuns, readUsage } from './state';
import type { StoryStore } from './story-store';
import { stripControlChars } from './text';
import {
  ANALYSIS_BLOCKS,
  ANALYSIS_PHASES,
  type AnalysisBlock,
  type AnalysisLink,
  type AnalysisLinkedPoint,
  type AnalysisPhase,
  type AnalysisSource,
  type AnalysisState,
  type SourceOrigin,
} from './analysis-types';
import type { StorySummary } from './types';

export const ANALYSIS_DIR = ANALYSIS_DIR_NAME;
export const ANALYSIS_STATE_FILE = ANALYSIS_STATE_NAME;
export const ANALYSIS_LOG_FILE = 'bitacora.md';
export const ANALYSIS_NAME_MAX_LENGTH = 120;
export const ANALYSIS_POINTS_FILE = 'puntos.json';
// Lo único del estado que escribe Claude: jm no confía en estado.json para él (tiene tareas de Jira y sesión)
export const ANALYSIS_PROGRESS_FILE = 'fase.json';
// Tope de lectura de los JSON que escribe Claude (puntos.json, fase.json)
export const CLAUDE_JSON_MAX_BYTES = 1024 * 1024;
export const ANALYSIS_PHASE_LABELS: Record<AnalysisPhase, string> = {
  sources: 'fuentes',
  debate: 'debate',
  documented: 'documentado',
};
export const ANALYSIS_BLOCK_LABELS: Record<AnalysisBlock, string> = {
  points: 'puntos',
  analysis: 'análisis',
  proposal: 'propuesta',
  estimation: 'estimación',
};
export const ANALYSIS_NEXT_STEP = 'Pulsa Enter para continuar el análisis.';
const ANALYSIS_DOCUMENTED_NEXT_STEP = 'Documentos listos en la carpeta del análisis. Pulsa Enter para retomarlo.';
const ANALYSIS_ID_PREFIX = 'an-';
const ANALYSIS_ID_PATTERN = new RegExp(`^${ANALYSIS_KEY_SOURCE}$`);
const POINT_ID_PATTERN = new RegExp(`^${POINT_ID_SOURCE}$`);
const NO_BLOCK_LABEL = '—';
const EPOCH = new Date(0).toISOString();

export const isValidAnalysisId = (id: string): boolean => ANALYSIS_ID_PATTERN.test(id);
export const isValidPointId = (id: string): boolean => POINT_ID_PATTERN.test(id);

export function assertAnalysisId(id: string): void {
  if (!isValidAnalysisId(id)) throw new Error(`Id de análisis inválido: "${id}". Usa el formato an-1.`);
}

// El siguiente es el mayor existente + 1: borrar uno intermedio nunca reutiliza su número
export function nextAnalysisId(existing: string[]): string {
  const numbers = existing.filter(isValidAnalysisId).map((id) => Number(id.slice(ANALYSIS_ID_PREFIX.length)));
  return `${ANALYSIS_ID_PREFIX}${Math.max(0, ...numbers) + 1}`;
}

export function cleanAnalysisName(raw: string): string {
  const name = stripControlChars(raw).trim().slice(0, ANALYSIS_NAME_MAX_LENGTH);
  if (!name) throw new Error('El análisis necesita un nombre.');
  return name;
}

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readTimestamp = (value: unknown): string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : EPOCH;

function readSources(value: unknown): AnalysisSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): AnalysisSource[] => {
    if (!isRecord(raw) || typeof raw.file !== 'string' || !raw.file) return [];
    const origin: SourceOrigin = raw.origin === 'text' ? 'text' : 'file';
    return [{ file: stripControlChars(raw.file), origin, addedAt: readTimestamp(raw.addedAt) }];
  });
}

function readLinkedPoints(value: unknown): Record<string, AnalysisLinkedPoint> {
  const points: Record<string, AnalysisLinkedPoint> = {};
  if (!isRecord(value)) return points;
  for (const [pointId, raw] of Object.entries(value)) {
    if (!isValidPointId(pointId) || !isRecord(raw)) continue;
    const { issueKey, parentKey } = raw;
    const valid = typeof issueKey === 'string' && isValidIssueKey(issueKey);
    if (valid && typeof parentKey === 'string' && isValidIssueKey(parentKey)) points[pointId] = { issueKey, parentKey };
  }
  return points;
}

// Sin épica ni puntos vinculados no hay vínculo
function readLink(value: unknown): AnalysisLink | undefined {
  if (!isRecord(value)) return undefined;
  const epicKey = typeof value.epicKey === 'string' && isValidIssueKey(value.epicKey) ? value.epicKey : null;
  const points = readLinkedPoints(value.points);
  return epicKey || Object.keys(points).length > 0 ? { epicKey, points } : undefined;
}

// El id sale siempre de la carpeta/argumento validado, nunca del contenido del archivo
function normalize(raw: unknown, id: string): AnalysisState {
  if (!isRecord(raw)) throw new Error('el contenido no es un objeto JSON');
  const referencedNotes = readReferencedNotes(raw.referencedNotes);
  const link = readLink(raw.link);
  return {
    id,
    name: typeof raw.name === 'string' ? stripControlChars(raw.name) : id,
    projectKey: typeof raw.projectKey === 'string' ? raw.projectKey : '',
    createdAt: readTimestamp(raw.createdAt),
    updatedAt: readTimestamp(raw.updatedAt),
    phase: ANALYSIS_PHASES.includes(raw.phase as AnalysisPhase) ? (raw.phase as AnalysisPhase) : 'sources',
    block: ANALYSIS_BLOCKS.includes(raw.block as AnalysisBlock) ? (raw.block as AnalysisBlock) : null,
    claudeSessionId:
      typeof raw.claudeSessionId === 'string' && SESSION_ID_PATTERN.test(raw.claudeSessionId)
        ? raw.claudeSessionId
        : null,
    usage: readUsage(raw.usage),
    sources: readSources(raw.sources),
    ...(referencedNotes.length > 0 ? { referencedNotes } : {}),
    trackingTasks: readPlanningTasks(raw.trackingTasks),
    taskRuns: readTaskRuns(raw.taskRuns),
    pointRuns: readTaskRuns(raw.pointRuns, isValidPointId),
    ...(link ? { link } : {}),
  };
}

// null si no existe; lanza si pasa del tope (un archivo de Claude no puede agotar la memoria)
export async function readClaudeJsonText(store: StoryStore, name: string): Promise<string | null> {
  const data = await store.readBinary(name, CLAUDE_JSON_MAX_BYTES);
  return data === null ? null : data.toString('utf8');
}

interface Progress {
  phase: AnalysisPhase | null;
  block: AnalysisBlock | null;
}

// fase.json lo escribe Claude: solo se aceptan fase y bloque conocidos; un archivo roto equivale a no tenerlo
async function readProgress(store: StoryStore): Promise<Progress | null> {
  let raw: unknown;
  try {
    const text = await readClaudeJsonText(store, ANALYSIS_PROGRESS_FILE);
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch {
    return null; // fase.json ilegible o enorme: se ignora y el análisis sigue con lo que jm guardó
  }
  if (!isRecord(raw)) return null;
  return {
    phase: ANALYSIS_PHASES.includes(raw.phase as AnalysisPhase) ? (raw.phase as AnalysisPhase) : null,
    block: ANALYSIS_BLOCKS.includes(raw.block as AnalysisBlock) ? (raw.block as AnalysisBlock) : null,
  };
}

// La fase solo avanza (la de estado.json es el respaldo de lo que Claude escribía allí antes de fase.json)
function withProgress(state: AnalysisState, progress: Progress | null): AnalysisState {
  if (!progress) return state;
  const phase =
    progress.phase && ANALYSIS_PHASES.indexOf(progress.phase) > ANALYSIS_PHASES.indexOf(state.phase)
      ? progress.phase
      : state.phase;
  return { ...state, phase, block: progress.block };
}

export async function readAnalysis(store: StoryStore, id: string): Promise<AnalysisState | null> {
  assertAnalysisId(id);
  const file = `${store.label}/${ANALYSIS_STATE_FILE}`;
  try {
    const text = await store.readText(ANALYSIS_STATE_FILE);
    if (text === null) return null;
    return withProgress(normalize(JSON.parse(text) as unknown, id), await readProgress(store));
  } catch (err: unknown) {
    throw new Error(`No pude leer ${file}: ${(err as Error).message}`);
  }
}

async function writeAnalysis(store: StoryStore, state: AnalysisState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await store.writeText(ANALYSIS_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// Lee justo antes de escribir, como el estado de las historias
export async function updateAnalysis(
  store: StoryStore,
  id: string,
  mutate: (state: AnalysisState) => void,
): Promise<AnalysisState> {
  const current = await readAnalysis(store, id);
  if (!current) throw new Error(`El análisis ${id} no existe.`);
  const previous = JSON.stringify(current);
  mutate(current);
  if (JSON.stringify(current) !== previous) await writeAnalysis(store, current);
  return current;
}

export async function createAnalysis(
  store: StoryStore,
  id: string,
  rawName: string,
  projectKey: string,
  now: Date = new Date(),
): Promise<AnalysisState> {
  assertAnalysisId(id);
  const name = cleanAnalysisName(rawName);
  // Nunca pisa un análisis existente con ese id
  if ((await store.readText(ANALYSIS_STATE_FILE)) !== null) throw new Error(`El análisis ${id} ya existe.`);
  await store.ensureReady();
  await store.writeText(ANALYSIS_LOG_FILE, `# Bitácora ${name}\n\n`);
  const state: AnalysisState = {
    id,
    name,
    projectKey,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    phase: 'sources',
    block: null,
    claudeSessionId: null,
    usage: emptyUsage(),
    sources: [],
    trackingTasks: [],
    taskRuns: {},
    pointRuns: {},
  };
  await writeAnalysis(store, state);
  return state;
}

// Un estado.json roto no debe tumbar el inicio: el análisis aparece con aviso
async function readOrPlaceholder(store: StoryStore, id: string): Promise<AnalysisState | null> {
  try {
    return await readAnalysis(store, id);
  } catch {
    return {
      ...normalize({}, id),
      name: `estado ilegible, revisa ${store.label}/${ANALYSIS_STATE_FILE}`,
      unreadable: true,
    };
  }
}

export async function listAnalysesFrom(stores: Array<{ id: string; store: StoryStore }>): Promise<AnalysisState[]> {
  const states = await Promise.all(stores.map(({ id, store }) => readOrPlaceholder(store, id)));
  return states.filter((s): s is AnalysisState => s !== null);
}

export function analysisSummary(state: AnalysisState): StorySummary {
  return {
    key: state.id,
    kind: 'analysis',
    summary: state.name,
    phase: ANALYSIS_PHASE_LABELS[state.phase],
    block: state.block ? ANALYSIS_BLOCK_LABELS[state.block] : NO_BLOCK_LABEL,
    nextStep: state.phase === 'documented' ? ANALYSIS_DOCUMENTED_NEXT_STEP : ANALYSIS_NEXT_STEP,
    updatedAt: state.updatedAt,
    ...(state.link?.epicKey ? { linkedEpicKey: state.link.epicKey } : {}),
  };
}

// Mismo filtro que las historias, pero por el proyecto guardado (el id no lo lleva); los ilegibles siempre se ven
export function filterAnalysesByProject(states: AnalysisState[], projectKey: string | null): AnalysisState[] {
  return projectKey ? states.filter((state) => state.unreadable || state.projectKey === projectKey) : states;
}

// La tarea de seguimiento abierta más reciente (creada y sin finalizar)
export function openTrackingOf(state: AnalysisState | null): string | null {
  const open = (state?.trackingTasks ?? []).filter((task) => state?.taskRuns[task.issueKey]?.status !== 'done');
  return open.length > 0 ? open[open.length - 1].issueKey : null;
}

export const analysisTrackingSummary = (name: string, date: string): string => `Análisis · ${name} · ${date}`;

// Avanza solo si el destino está por delante: nunca pisa un avance que hizo la skill
export const advanceAnalysisPhase = (store: StoryStore, id: string, to: AnalysisPhase): Promise<AnalysisState> =>
  updateAnalysis(store, id, (state) => {
    if (ANALYSIS_PHASES.indexOf(to) > ANALYSIS_PHASES.indexOf(state.phase)) state.phase = to;
  });

// La bitácora nace con solo el título: cualquier otra cosa es avance
export async function hasAnalysisLogProgress(store: StoryStore, name: string): Promise<boolean> {
  const log = await store.readText(ANALYSIS_LOG_FILE);
  return log !== null && log.trim() !== `# Bitácora ${name}`;
}
