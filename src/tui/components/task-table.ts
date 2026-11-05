// Columnas alineadas de la lista de tareas de la revisión (puro, sin Ink)
import type { ReviewTask } from '../../refinement/review-types.js';
import { PLAN_TEXTS, RISK_LABELS } from '../texts.js';
import { formatDuration } from './duration.js';
import { fitText, textWidth } from './table.js';

export interface TaskCells {
  id: string;
  title: string;
  pert: string | null;
  jira: string;
  due: string;
  risk: string;
}

export const TASK_ROW_PREFIX_WIDTH = 6;
export const COLUMN_GAP = '  ';
const MIN_TITLE_WIDTH = 16;
const FALLBACK_TITLE_WIDTH = 8;

const widest = (values: string[]): number => Math.max(0, ...values.map(textWidth));

function rawCells(task: ReviewTask) {
  const { optimistic, likely, pessimistic } = task.estimate;
  return {
    id: task.id,
    title: task.summary,
    pert: `O ${optimistic} M ${likely} P ${pessimistic} · ~${formatDuration(task.expectedSeconds)}`,
    jira: PLAN_TEXTS.jiraEstimate(formatDuration(task.effectiveSeconds), Boolean(task.finalEstimate)),
    due: task.effectiveDate ? PLAN_TEXTS.dueDate(task.effectiveDate, task.dateManual) : '',
    risk: RISK_LABELS[task.risk],
  };
}

// El título se lleva el ancho que sobra; la columna O/M/P se omite cuando lo dejaría demasiado angosto
export function buildTaskCells(tasks: ReviewTask[], available: number): TaskCells[] {
  const raw = tasks.map(rawCells);
  const fixed = (keys: Array<'id' | 'pert' | 'jira' | 'due' | 'risk'>) =>
    keys.reduce((total, key) => total + widest(raw.map((cells) => cells[key])) + COLUMN_GAP.length, 0);
  const base = ['id', 'jira', 'due', 'risk'] as const;
  const withPert = [...base, 'pert'] as const;
  const room = (keys: typeof withPert | typeof base) =>
    available - TASK_ROW_PREFIX_WIDTH - COLUMN_GAP.length - fixed([...keys]);
  const showPert = room(withPert) >= MIN_TITLE_WIDTH;
  const keys = showPert ? withPert : base;
  const titleWidth = Math.max(FALLBACK_TITLE_WIDTH, Math.min(room(keys), widest(raw.map((cells) => cells.title))));
  const widths = Object.fromEntries(keys.map((key) => [key, widest(raw.map((cells) => cells[key]))]));
  return raw.map((cells) => ({
    id: fitText(cells.id, widths.id),
    title: fitText(cells.title, titleWidth),
    pert: showPert ? fitText(cells.pert, widths.pert) : null,
    jira: fitText(cells.jira, widths.jira),
    due: fitText(cells.due, widths.due),
    risk: fitText(cells.risk, widths.risk),
  }));
}

export interface CreatedRow {
  key: string;
  summary: string;
  note: string;
}

// Clave en columna fija y título recortado para que la nota («ya estaba») siempre quede visible
export function alignCreated(rows: CreatedRow[], available: number): string[] {
  const keyWidth = widest(rows.map((row) => row.key));
  const noteWidth = widest(rows.map((row) => row.note));
  return rows.map((row) => {
    const titleWidth = Math.max(FALLBACK_TITLE_WIDTH, available - keyWidth - noteWidth - 2 * COLUMN_GAP.length);
    const title = fitText(row.summary, Math.min(titleWidth, Math.max(textWidth(row.summary), 1)));
    return `${fitText(row.key, keyWidth)} · ${title}${row.note ? ` ${row.note}` : ''}`.trimEnd();
  });
}
