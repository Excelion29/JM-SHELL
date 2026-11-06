import { escapeCell, PHASE_LABELS } from './state';
import type { StoryStore } from './story-store';
import type { StoryState } from './types';

// Nombre válido para la bóveda (sin punto inicial) que además queda primero al ordenar la carpeta
export const INDEX_FILE = '00-indice.md';
const INDEX_HEADER = [
  '# Índice JM-ADR',
  '',
  'Lo mantiene `jm` al crear historias, cambiar de fase y crear tareas. No lo edites: se rehace por fila.',
  '',
  '| Historia | Resumen | Fase | Tareas | Actualizado |',
  '|---|---|---|---|---|',
];
const ROW_PATTERN = /^\| \[\[([^\]|]+)\]\] \|/;
const NO_TASKS = '—';

function rowOf(state: StoryState): string {
  const tasks = Object.values(state.createdIssues);
  const cells = [
    `[[${state.key}]]`,
    escapeCell(state.summary),
    PHASE_LABELS[state.phase],
    tasks.length ? escapeCell(tasks.join(', ')) : NO_TASKS,
    state.updatedAt,
  ];
  return `| ${cells.join(' | ')} |`;
}

// Reemplaza (o agrega) la fila de la historia y deja el resto de filas como estaban
export function upsertIndexRow(current: string | null, state: StoryState): string {
  const rows = new Map<string, string>();
  for (const line of (current ?? '').split(/\r?\n/)) {
    const match = ROW_PATTERN.exec(line);
    if (match) rows.set(match[1], line);
  }
  rows.set(state.key, rowOf(state));
  const sorted = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, line]) => line);
  return `${[...INDEX_HEADER, ...sorted].join('\n')}\n`;
}

// adrStore apunta a la carpeta JM-ADR (no a la de una historia)
export const createIndexUpdater =
  (adrStore: StoryStore) =>
  async (state: StoryState): Promise<void> => {
    await adrStore.writeText(INDEX_FILE, upsertIndexRow(await adrStore.readText(INDEX_FILE), state));
  };
