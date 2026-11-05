// Contrato entre el puente (CJS) y las pantallas de revisión, creación y cierre (isla ESM): solo tipos
import type { AttachmentPurpose, Phase, PlannedTask, TaskEstimate } from './types';

export interface ReviewTask extends PlannedTask {
  expectedSeconds: number;
  stdDevSeconds: number;
  // Recomendación (PERT redondeado a 5 min) y lo que realmente irá a Jira
  recommendedSeconds: number;
  effectiveSeconds: number;
  // Fechas YYYY-MM-DD; null en tareas sin marcar
  recommendedDate: string | null;
  effectiveDate: string | null;
  dateManual: boolean;
}

export interface ReviewFile {
  file: string;
  purpose: AttachmentPurpose;
  taskIds: string[];
}

export interface ReviewTotals {
  taskCount: number;
  expectedSeconds: number;
  effectiveSeconds: number;
  stdDevSeconds: number;
}

export interface ReviewModel {
  storyKey: string;
  summary: string;
  phase: Phase;
  tasks: ReviewTask[];
  files: ReviewFile[];
  totals: ReviewTotals;
  // Carga por día (YYYY-MM-DD -> segundos) con las fechas efectivas, y capacidad para avisar al excederla
  daySeconds: Record<string, number>;
  dailyCapacitySeconds: number;
}

export interface TaskPatch {
  include?: boolean;
  summary?: string;
  estimate?: TaskEstimate;
  // Texto vacío o null: borra la estimación propia y vuelve a la recomendación
  finalEstimate?: string | null;
  // AAAA-MM-DD, "hoy", "mañana" o "+N"; texto vacío o null: vuelve a la fecha recomendada
  dueDate?: string | null;
}

export type EstimatePreview =
  { ok: true; expectedSeconds: number; stdDevSeconds: number } | { ok: false; message: string };

export type ChildKind = 'subtask' | 'standard';

// Dónde y con qué tipo se crean las tareas; la pantalla lo recibe y lo devuelve sin tocarlo
export interface CreationTarget {
  parentKey: string;
  parentSummary: string;
  childKind: ChildKind;
  issueTypeId: string;
  issueTypeName: string;
}

export type AskReason = 'epic' | 'subtask' | 'done' | 'not-found';

export type ParentOutcome =
  | { kind: 'ready'; target: CreationTarget }
  | { kind: 'ask'; reason: AskReason; epicKey: string | null; epicSummary: string | null };

export type TargetResult = { ok: true; target: CreationTarget } | { ok: false; message: string };

export interface AssigneeView {
  accountId: string;
  displayName: string;
}

export interface PlannedUpload {
  file: string;
  purpose: AttachmentPurpose;
  taskIds: string[];
}

// Tarea del plan cuyo título ya existe bajo el padre: se vincula en vez de crearse, solo si el dev lo confirma
export interface ExistingMatch {
  taskId: string;
  key: string;
  summary: string;
}

export interface CreatePreview {
  taskCount: number;
  // Suma de lo que irá a Jira (estimación propia o recomendada)
  estimateSeconds: number;
  parent: ParentOutcome;
  assignee: AssigneeView;
  uploads: PlannedUpload[];
  // Coincidencias contra el padre por defecto (vacío si el padre aún hay que elegirlo)
  existing: ExistingMatch[];
}

export interface CreateRequest {
  target: CreationTarget;
  assigneeId: string;
  // Vínculos confirmados por el dev (taskId -> clave); sin confirmar, no se adopta nada
  adopt: Record<string, string>;
}

export interface CreatedTask {
  taskId: string;
  key: string;
  summary: string;
  existing: boolean;
}

export type CreateStep = 'creating' | 'created' | 'existing' | 'uploading' | 'uploaded';

export interface CreateProgress {
  index: number;
  total: number;
  summary: string;
  step: CreateStep;
  detail?: string;
}

export type CreateOutcome =
  | { ok: true; created: CreatedTask[]; parentKey: string; estimateSkipped: boolean }
  | { ok: false; message: string; created: CreatedTask[] };

export interface CloseFileView {
  file: string;
  reason: string;
}

export interface ClosePreview {
  deletable: CloseFileView[];
  kept: CloseFileView[];
}

export interface CloseResult {
  deleted: string[];
  kept: CloseFileView[];
}

// Objeto plano que la isla ESM recibe como prop
export interface PlanBridge {
  load: (key: string) => Promise<ReviewModel>;
  previewEstimate: (estimate: TaskEstimate) => EstimatePreview;
  updateTask: (key: string, taskId: string, patch: TaskPatch) => Promise<ReviewModel>;
  setAttachmentPurpose: (key: string, file: string, purpose: AttachmentPurpose) => Promise<ReviewModel>;
  toggleAttachmentTask: (key: string, file: string, taskId: string) => Promise<ReviewModel>;
  openAttachment: (key: string, file: string) => Promise<void>;
  prepareCreate: (key: string) => Promise<CreatePreview>;
  resolveTarget: (parentKey: string) => Promise<TargetResult>;
  findExisting: (key: string, target: CreationTarget) => Promise<ExistingMatch[]>;
  listAssignees: (key: string) => Promise<AssigneeView[]>;
  create: (
    key: string,
    request: CreateRequest,
    onProgress: (progress: CreateProgress) => void,
  ) => Promise<CreateOutcome>;
  openInBrowser: (issueKey: string) => Promise<void>;
  prepareClose: (key: string) => Promise<ClosePreview>;
  close: (key: string, files: string[]) => Promise<CloseResult>;
}
