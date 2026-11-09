// Análisis sin historia (parte 10B-1): un tipo propio con id local `an-<n>`, nunca una clave de Jira
import { readPlanningTasks, readTaskRuns } from './state';
import type { StoryStore } from './story-store';
import { stripControlChars } from './text';
import type { AnalysisPhase, AnalysisSource, AnalysisState, SourceOrigin } from './analysis-types';
import type { StorySummary } from './types';

export const ANALYSIS_DIR = 'analisis';
export const ANALYSIS_STATE_FILE = 'estado.json';
export const ANALYSIS_LOG_FILE = 'bitacora.md';
export const ANALYSIS_NAME_MAX_LENGTH = 120;
export const ANALYSIS_PHASE_LABELS: Record<AnalysisPhase, string> = { sources: 'fuentes' };
export const ANALYSIS_NEXT_STEP = 'Pulsa Enter para continuar el análisis.';
const ANALYSIS_ID_PREFIX = 'an-';
const ANALYSIS_ID_PATTERN = /^an-\d{1,6}$/;
const NO_BLOCK_LABEL = '—';
const EPOCH = new Date(0).toISOString();

export const isValidAnalysisId = (id: string): boolean => ANALYSIS_ID_PATTERN.test(id);

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

// El id sale siempre de la carpeta/argumento validado, nunca del contenido del archivo
function normalize(raw: unknown, id: string): AnalysisState {
  if (!isRecord(raw)) throw new Error('el contenido no es un objeto JSON');
  return {
    id,
    name: typeof raw.name === 'string' ? stripControlChars(raw.name) : id,
    projectKey: typeof raw.projectKey === 'string' ? raw.projectKey : '',
    createdAt: readTimestamp(raw.createdAt),
    updatedAt: readTimestamp(raw.updatedAt),
    phase: 'sources',
    sources: readSources(raw.sources),
    trackingTasks: readPlanningTasks(raw.trackingTasks),
    taskRuns: readTaskRuns(raw.taskRuns),
  };
}

export async function readAnalysis(store: StoryStore, id: string): Promise<AnalysisState | null> {
  assertAnalysisId(id);
  const file = `${store.label}/${ANALYSIS_STATE_FILE}`;
  try {
    const text = await store.readText(ANALYSIS_STATE_FILE);
    return text === null ? null : normalize(JSON.parse(text) as unknown, id);
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
    sources: [],
    trackingTasks: [],
    taskRuns: {},
  };
  await writeAnalysis(store, state);
  return state;
}

// Un estado.json roto no debe tumbar el inicio: el análisis aparece con aviso
async function readOrPlaceholder(store: StoryStore, id: string): Promise<AnalysisState | null> {
  try {
    return await readAnalysis(store, id);
  } catch {
    return { ...normalize({}, id), name: `estado ilegible, revisa ${store.label}/${ANALYSIS_STATE_FILE}`, unreadable: true };
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
    block: NO_BLOCK_LABEL,
    nextStep: ANALYSIS_NEXT_STEP,
    updatedAt: state.updatedAt,
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
