// Columnas alineadas de la pantalla de Tareas y de Mi día (puro, sin Ink)
import type { MyDayRow, TaskRow } from '../../refinement/tasks-types.js';
import { TASKS_TEXTS } from '../texts.js';
import { formatDuration } from './duration.js';
import { fitText, textWidth } from './table.js';

export const TASKS_ROW_PREFIX_WIDTH = 4;
const COLUMN_GAP = '  ';
const MIN_TITLE_WIDTH = 12;
const TITLE_SEPARATORS = 2;

export interface RowCells {
  key: string;
  title: string;
  status: string;
  assignee: string;
  estimate: string;
  due: string;
}

const PENDING_CATEGORIES: readonly string[] = ['new', 'indeterminate', 'unknown'];

export const isPending = (row: TaskRow): boolean => !row.missing && PENDING_CATEGORIES.includes(row.category);

// Lo accionable primero: en curso, por hacer, sin estado conocido; las finalizadas y las que Jira no devuelve al final
const CATEGORY_ORDER: Record<string, number> = { indeterminate: 0, new: 1, unknown: 2, done: 3 };
const MISSING_ORDER = 4;

const rowOrder = (row: TaskRow): number =>
  row.missing ? MISSING_ORDER : (CATEGORY_ORDER[row.category] ?? MISSING_ORDER);

// sort es estable: dentro de cada grupo se respeta el orden de creación
export const visibleRows = (rows: TaskRow[], pendingOnly: boolean): TaskRow[] =>
  (pendingOnly ? rows.filter(isPending) : [...rows]).sort((a, b) => rowOrder(a) - rowOrder(b));

export function summaryLine(rows: TaskRow[]): string {
  const live = rows.filter((row) => !row.missing);
  const done = live.filter((row) => row.category === 'done').length;
  const pendingSeconds = live.filter(isPending).reduce((sum, row) => sum + (row.estimateSeconds ?? 0), 0);
  return TASKS_TEXTS.summary(done, live.length, formatDuration(pendingSeconds));
}

const estimateText = (seconds: number | null) => (seconds === null ? TASKS_TEXTS.noEstimate : formatDuration(seconds));

function rawCells(row: TaskRow): RowCells {
  const notes = [
    row.inPlan ? '' : TASKS_TEXTS.notInPlan,
    row.missing ? TASKS_TEXTS.missing : '',
    row.pendingDone ? TASKS_TEXTS.pendingDone : '',
  ].filter(Boolean);
  return {
    key: row.key,
    title: notes.length > 0 ? `${row.title} (${notes.join(', ')})` : row.title,
    status: row.status,
    assignee: row.assignee ?? TASKS_TEXTS.noAssignee,
    estimate: estimateText(row.estimateSeconds),
    due: row.dueDate ?? TASKS_TEXTS.noDate,
  };
}

const widest = (values: string[]) => Math.max(0, ...values.map(textWidth));

function fitCells(raw: RowCells[], available: number): RowCells[] {
  const width = (key: keyof RowCells) => widest(raw.map((cells) => cells[key]));
  const fixed = (['key', 'status', 'assignee', 'estimate', 'due'] as const).reduce(
    (total, key) => total + width(key) + COLUMN_GAP.length,
    0,
  );
  const titleWidth = Math.max(
    MIN_TITLE_WIDTH,
    Math.min(available - TASKS_ROW_PREFIX_WIDTH - fixed - TITLE_SEPARATORS, width('title')),
  );
  return raw.map((cells) => ({
    key: fitText(cells.key, width('key')),
    title: fitText(cells.title, titleWidth),
    status: fitText(cells.status, width('status')),
    assignee: fitText(cells.assignee, width('assignee')),
    estimate: fitText(cells.estimate, width('estimate')),
    due: fitText(cells.due, width('due')),
  }));
}

export const buildRowCells = (rows: TaskRow[], available: number): RowCells[] =>
  fitCells(rows.map(rawCells), available);

export const joinCells = (cells: RowCells): string =>
  [cells.key, cells.title, cells.status, cells.assignee, cells.estimate, cells.due].join(COLUMN_GAP);

export function buildMyDayCells(rows: MyDayRow[], available: number): RowCells[] {
  const raw: RowCells[] = rows.map((row) => ({
    key: row.key,
    title: row.title,
    status: row.status,
    assignee: row.parentKey ?? '',
    estimate: estimateText(row.estimateSeconds),
    due: row.dueDate ?? TASKS_TEXTS.noDate,
  }));
  return fitCells(raw, available);
}
