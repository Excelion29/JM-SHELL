// Contrato entre el puente de tareas (CJS) y las pantallas de Tareas y Mi día (isla ESM): solo tipos
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
  openInBrowser: (issueKey: string) => Promise<void>;
}
