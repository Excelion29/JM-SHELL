// Contrato entre el puente de tareas (CJS) y las pantallas de Tareas y Mi día (isla ESM): solo tipos
import type { ManagementProblem } from './management-types';

export type StatusCategory = 'new' | 'indeterminate' | 'done' | 'unknown';

export interface TaskRow {
  key: string;
  title: string;
  status: string;
  category: StatusCategory;
  assignee: string | null;
  estimateSeconds: number | null;
  dueDate: string | null;
  inPlan: boolean;
  // Está en el registro de la historia pero Jira ya no la devuelve
  missing: boolean;
  pendingDone: boolean;
  // Tiempo real medido por jm: con Claude abierto y de inicio a fin; null si nunca se inició con jm
  realClaudeSeconds: number | null;
  realElapsedSeconds: number | null;
}

export interface TasksModel {
  storyKey: string;
  summary: string;
  rows: TaskRow[];
}

export interface TransitionOptions {
  // El dev confirmó reabrir una tarea ya finalizada
  reopen?: boolean;
  // Transición elegida a mano de la lista que ofrece el proyecto
  transitionName?: string;
  // Finalizar sin haber iniciado ni abierto Claude: el registro no mide tiempo
  direct?: boolean;
}

export type TransitionOutcome =
  | { kind: 'ok'; storyKey: string | null }
  | { kind: 'needs-reopen' }
  | { kind: 'choose'; available: string[] }
  | { kind: 'failed'; message: string };

export interface DeleteResult {
  key: string;
  ok: boolean;
  message?: string;
}

export interface PendingRetry {
  finished: string[];
  failed: string[];
}

export interface MyDayRow {
  key: string;
  title: string;
  parentKey: string | null;
  status: string;
  category: StatusCategory;
  estimateSeconds: number | null;
  dueDate: string | null;
  overdue: boolean;
}

export interface MyDayModel {
  rows: MyDayRow[];
  totalSeconds: number;
  capacitySeconds: number;
}

export interface TaskFinishTarget {
  // null: tarea de "Mi día" que no pertenece a una historia de jm
  storyKey: string | null;
  issueKey: string;
}

// Calibración estimado vs. real: solo tareas finalizadas que se iniciaron con jm y están en el plan
export type CalibrationRisk = 'low' | 'medium' | 'high';

// real ≈ factor × recomendada, con cuántas tareas medidas sale
export interface HistoryFactor {
  factor: number;
  count: number;
}

export interface CalibrationGroup {
  count: number;
  estimateSeconds: number;
  claudeSeconds: number;
  elapsedSeconds: number;
  // real / estimado; null si la estimación suma 0
  claudeRatio: number | null;
  elapsedRatio: number | null;
}

export interface CalibrationOutlier {
  key: string;
  storyKey: string;
  title: string;
  estimateSeconds: number;
  claudeSeconds: number;
  elapsedSeconds: number;
}

export interface CalibrationModel {
  total: CalibrationGroup;
  byRisk: Array<{ risk: CalibrationRisk } & CalibrationGroup>;
  outliers: CalibrationOutlier[];
  // Finalizadas con f, sin inicio medido
  excludedDirect: number;
  // Historias que no se pudieron leer (p. ej. base sin conexión)
  unreadable: number;
  // Planificaciones finalizadas: aparte, no tienen estimación de Claude con qué comparar
  planning: PlanningGroup;
  // Puntos de análisis finalizados (tareas solo de jm): estimado esperado por Claude vs. real de inicio a fin
  analysisPoints: PlanningGroup;
}

// Tarea de Planificación al entrar a una historia (parte 9)
export interface PlanningStatus {
  // Clave de una Planificación aún abierta en la historia; null si no hay
  open: string | null;
  // Clave de gestión del proyecto de la historia (donde irá la Planificación); null = en la misma historia
  managementKey: string | null;
}

export interface PlanningSuggestion {
  // Textos listos para el formulario (1h, 1h30m; hoy) y cuántas Planificaciones finalizadas respaldan la estimación
  estimate: string;
  dueDate: string;
  measured: number;
}

export interface PlanningInput {
  // Como la estimación propia (3h, 45m) y la fecha de la revisión (AAAA-MM-DD, hoy, mañana, +N)
  estimate: string;
  dueDate: string;
}

// La de gestión no sirvió y la Planificación quedó en la historia actual
export interface PlanningFallback {
  key: string;
  reason: ManagementProblem;
  message: string;
}

// askWhere: el destino no sirvió (análisis sin historia): hay que elegir otro, aún no se creó nada en Jira
export type PlanningOutcome =
  | { ok: true; issueKey: string; started: boolean; fallback?: PlanningFallback }
  | { ok: false; message: string; askWhere?: boolean };

export interface PlanningGroup {
  count: number;
  estimateSeconds: number;
  elapsedSeconds: number;
}

export interface TasksBridge {
  load: (storyKey: string) => Promise<TasksModel>;
  start: (storyKey: string, issueKey: string, options: TransitionOptions) => Promise<TransitionOutcome>;
  startMyDay: (issueKey: string, parentKey: string | null, options: TransitionOptions) => Promise<TransitionOutcome>;
  finish: (target: TaskFinishTarget, options: TransitionOptions) => Promise<TransitionOutcome>;
  finishMyDay: (issueKey: string, parentKey: string | null, options: TransitionOptions) => Promise<TransitionOutcome>;
  retryPending: (storyKey: string) => Promise<PendingRetry>;
  returnOptions: (issueKey: string) => Promise<string[]>;
  returnTo: (issueKey: string, transitionName: string) => Promise<void>;
  remove: (storyKey: string, keys: string[]) => Promise<DeleteResult[]>;
  myDay: () => Promise<MyDayModel>;
  calibration: () => Promise<CalibrationModel>;
  planningStatus: (storyKey: string) => Promise<PlanningStatus>;
  planningSuggestion: () => Promise<PlanningSuggestion>;
  createPlanning: (storyKey: string, input: PlanningInput) => Promise<PlanningOutcome>;
  openInBrowser: (issueKey: string) => Promise<void>;
}
