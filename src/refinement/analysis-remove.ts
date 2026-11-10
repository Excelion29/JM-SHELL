// Borrar un análisis libre (10B-2b): su carpeta entera y las copias de sus fuentes en la carpeta de trabajo
import * as fs from 'fs';
import * as path from 'path';
import { ANALYSIS_STATE_FILE, assertAnalysisId, readAnalysis } from './analysis';
import type { AnalysisState, RemoveAnalysisOutcome } from './analysis-types';
import { assertStoryName, readJson, type StoryStore } from './story-store';
import { WORK_ANALYSIS_DIR, WORK_ATTACHMENTS_DIR } from './workdir';

interface Listed {
  files: string[];
  // Del más profundo al más superficial: una carpeta solo se quita ya vacía
  folders: string[];
}

async function collect(store: StoryStore, dir: string, found: Listed): Promise<void> {
  for (const entry of await store.list(dir)) {
    const name = dir === '' ? entry.name : `${dir}/${entry.name}`;
    // Se valida todo antes de borrar nada: un nombre que el almacén rechaza dejaría el borrado a medias
    try {
      assertStoryName(name);
    } catch {
      throw new Error(`El análisis tiene un archivo que jm no puede borrar ("${name}"); quítalo a mano y reintenta.`);
    }
    if (entry.isFile) found.files.push(name);
    else {
      await collect(store, name, found);
      found.folders.push(name);
    }
  }
}

// estado.json va al final: si algo falla a medias, el análisis sigue visible en el inicio para reintentar
const stateLast = (files: string[]): string[] => [
  ...files.filter((file) => file !== ANALYSIS_STATE_FILE),
  ...files.filter((file) => file === ANALYSIS_STATE_FILE),
];

export async function removeAnalysisFolder(store: StoryStore): Promise<void> {
  const found: Listed = { files: [], folders: [] };
  await collect(store, '', found);
  for (const file of stateLast(found.files)) await store.remove(file);
  for (const folder of found.folders) await store.removeFolder(folder);
  await store.removeFolder('');
}

export function removeAnalysisWorkCopies(workDir: string, id: string): void {
  assertAnalysisId(id);
  const base = path.join(workDir, WORK_ATTACHMENTS_DIR, WORK_ANALYSIS_DIR);
  const target = path.join(base, id);
  if (path.relative(base, target) !== id) throw new Error(`Ruta de copias fuera de la carpeta de trabajo: ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
}

// Con una tarea en Jira no se borra: dejaría la tarea huérfana de su análisis
export async function removeAnalysis(store: StoryStore, workDir: string, id: string): Promise<RemoveAnalysisOutcome> {
  assertAnalysisId(id);
  const state: AnalysisState | null = await readAnalysis(store, id);
  if (!state) return { ok: false, message: `El análisis ${id} no existe.` };
  if (state.trackingTasks.length > 0) {
    const keys = state.trackingTasks.map((task) => task.issueKey).join(', ');
    return { ok: false, message: `${id} tiene su tarea en Jira (${keys}); no lo borro.` };
  }
  // La lectura normalizada descarta tareas mal formadas: se mira también el estado crudo para no dejar una huérfana
  const rawState = await readJson(store, ANALYSIS_STATE_FILE);
  if (hasRawTrackingTasks(rawState)) {
    return { ok: false, message: `${id} tiene una tarea en Jira que no pude leer; no lo borro.` };
  }
  if (hasRawPointRuns(rawState)) {
    return { ok: false, message: `${id} tiene puntos iniciados; no lo borro para no perder su tiempo.` };
  }
  if (hasRawLink(rawState)) return { ok: false, message: `${id} está vinculado a Jira; no lo borro.` };
  // Copias primero: si la carpeta falla después, el análisis sigue visible y no quedan copias huérfanas
  removeAnalysisWorkCopies(workDir, id);
  await removeAnalysisFolder(store);
  return { ok: true };
}

function hasRawTrackingTasks(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const tasks = (raw as { trackingTasks?: unknown }).trackingTasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

// Una entrada mal formada también cuenta: la lectura normalizada la descartaría y se perdería su tiempo
function hasRawPointRuns(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const runs = (raw as { pointRuns?: unknown }).pointRuns;
  return typeof runs === 'object' && runs !== null && Object.keys(runs).length > 0;
}

// Cualquier épica o punto vinculado cuenta, aunque la lectura normalizada lo descartara
function hasRawLink(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const link = (raw as { link?: unknown }).link;
  if (typeof link !== 'object' || link === null) return false;
  const { epicKey, points } = link as { epicKey?: unknown; points?: unknown };
  const hasPoints = typeof points === 'object' && points !== null && Object.keys(points).length > 0;
  return Boolean(epicKey) || hasPoints;
}
