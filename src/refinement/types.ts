export const PHASES = ['spec', 'debate', 'plan', 'reviewed', 'created', 'in-progress', 'closed'] as const;
export type Phase = (typeof PHASES)[number];

export const BLOCKS = ['scope', 'dependencies', 'risks', 'done-criteria', 'tasks', 'estimation'] as const;
export type Block = (typeof BLOCKS)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

export const ATTACHMENT_PURPOSES = ['analysis', 'evidence', 'team'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

export type AttachmentOrigin = 'jira' | 'local';

export interface TaskEstimate {
  optimistic: string;
  likely: string;
  pessimistic: string;
}

export interface PlannedTask {
  id: string;
  summary: string;
  description: string;
  doneCriteria: string[];
  estimate: TaskEstimate;
  risk: Risk;
  rationale: string;
  include: boolean;
  attachments: string[];
  // Estimación propia del dev ("3h"): si existe, va a Jira en lugar de la recomendación
  finalEstimate?: string;
  // Fecha YYYY-MM-DD fijada a mano; solo vale con dueDateManual (si no, se recomienda al cargar)
  dueDate?: string;
  dueDateManual?: boolean;
}

export interface RefinementPlan {
  storyKey: string;
  tasks: PlannedTask[];
}

export interface StoryAttachment {
  file: string;
  purpose: AttachmentPurpose;
  origin: AttachmentOrigin;
  taskIds: string[];
  uploaded: Record<string, string>;
}

export interface StoryUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  turns: number;
}

export type TaskRunStatus = 'started' | 'done';

// Tiempo real de una tarea: reloj de pared (startedAt -> finishedAt) y suma de sesiones de Claude (activeMs)
export interface TaskRun {
  issueKey: string;
  claudeSessionId: string | null;
  // null solo en cierres directos: no hubo inicio medido
  startedAt: string | null;
  finishedAt: string | null;
  activeMs: number;
  status: TaskRunStatus;
  // Finalizada sin abrir Claude: la calibración estimado-vs-real la excluye
  finishedDirect?: boolean;
  // Inicio a fin de los tramos anteriores a una reapertura: activeMs ya los acumula, el reloj de pared también
  priorElapsedMs?: number;
  // Se terminó pero Jira no respondió: se reintenta con `r`
  pendingDone?: boolean;
}

export interface StoryState {
  key: string;
  summary: string;
  phase: Phase;
  block: Block | null;
  claudeSessionId: string | null;
  parentKey: string | null;
  createdIssues: Record<string, string>;
  // Por clave de Jira de la subtarea
  taskRuns: Record<string, TaskRun>;
  attachments: StoryAttachment[];
  usage: StoryUsage;
  updatedAt: string;
  // Versión de los enlaces entre notas de la base (ver NOTES_VERSION); sin valor, las notas aún no se repararon
  notesVersion?: number;
  // Tareas de Planificación registradas al entrar a la historia (su tiempo vive en taskRuns, como las demás)
  planningTasks?: PlanningTask[];
}

export interface PlanningTask {
  issueKey: string;
  estimateSeconds: number;
  createdAt: string;
}

export type SummaryKind = 'story' | 'analysis';

export interface StorySummary {
  key: string;
  // Sin valor es una historia; un análisis sin historia lleva su id local (an-1)
  kind?: SummaryKind;
  summary: string;
  phase: string;
  // Fase sin traducir: la app decide con ella qué atajos admite la historia
  phaseId?: Phase;
  block: string;
  nextStep: string;
  updatedAt: string;
}

export interface BrowseItem {
  key: string;
  summary: string;
  status: string;
}

export interface ProjectItem {
  key: string;
  name: string;
}
