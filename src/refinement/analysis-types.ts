// Análisis sin historia (parte 10B): estado guardado y contrato entre el puente (CJS) y las pantallas (isla ESM)
import type { PlanningInput, PlanningOutcome, PlanningStatus, PlanningSuggestion } from './tasks-types';
import type { PlanningTask, StoryUsage, TaskRun } from './types';

export const ANALYSIS_PHASES = ['sources', 'debate', 'documented'] as const;
export type AnalysisPhase = (typeof ANALYSIS_PHASES)[number];

// Bloques del debate: puntos -> análisis por punto -> propuesta -> estimación
export const ANALYSIS_BLOCKS = ['points', 'analysis', 'proposal', 'estimation'] as const;
export type AnalysisBlock = (typeof ANALYSIS_BLOCKS)[number];

export type SourceOrigin = 'file' | 'text';

export interface AnalysisSource {
  file: string;
  origin: SourceOrigin;
  addedAt: string;
}

export interface AnalysisState {
  id: string;
  name: string;
  projectKey: string;
  createdAt: string;
  updatedAt: string;
  phase: AnalysisPhase;
  block: AnalysisBlock | null;
  claudeSessionId: string | null;
  usage: StoryUsage;
  sources: AnalysisSource[];
  // Notas de la base (ruta relativa a la bóveda, .md) que Claude lee directo; no se copian
  referencedNotes?: string[];
  // Tareas de seguimiento "Análisis · <nombre> · fecha" en Jira (su tiempo vive en taskRuns)
  trackingTasks: PlanningTask[];
  taskRuns: Record<string, TaskRun>;
  // Tiempo de cada punto que el dev trabaja con Claude (por id: P1); solo jm lo escribe, nunca puntos.json
  pointRuns: Record<string, TaskRun>;
  // Vínculo con Jira (10C): la épica del análisis y la tarea o subtarea creada por punto; solo jm lo escribe
  link?: AnalysisLink;
  // estado.json ilegible: aparece en el inicio con aviso y no cuenta para la calibración
  unreadable?: boolean;
}

export interface AnalysisLinkedPoint {
  issueKey: string;
  // Épica o historia bajo la que se creó: un punto ya creado no cambia de destino desde jm
  parentKey: string;
}

export interface AnalysisLink {
  epicKey: string | null;
  points: Record<string, AnalysisLinkedPoint>;
}

export type SourceResult = { source: string; ok: true; file: string } | { source: string; ok: false; message: string };

export interface SourcesInput {
  // Rutas absolutas separadas por coma, punto y coma o salto de línea; pueden venir entre comillas
  paths: string;
  // Texto pegado: se agrega a fuentes/texto.md
  text: string;
}

export interface NewAnalysisInput extends SourcesInput {
  name: string;
}

export type CreateAnalysisOutcome = { ok: true; id: string; results: SourceResult[] } | { ok: false; message: string };

export type AddSourcesOutcome = { ok: true; results: SourceResult[] } | { ok: false; message: string };

export type RemoveAnalysisOutcome = { ok: true } | { ok: false; message: string };

export interface AnalysisTrackingSummary {
  issueKey: string;
  status: TaskRun['status'];
}

export interface AnalysisDetail {
  id: string;
  name: string;
  sources: AnalysisSource[];
  tracking: AnalysisTrackingSummary[];
  // Ya se documentó (fase final): hay documentos que borrar junto con el análisis
  documented: boolean;
}

export type PointStatus = 'pending' | 'started' | 'done';

export interface PointRow {
  id: string;
  title: string;
  status: PointStatus;
  // PERT esperado del punto; null si Claude no le puso estimación
  estimateSeconds: number | null;
  // null mientras no se haya medido (pendiente sin iniciar o cerrado sin abrir Claude)
  realClaudeSeconds: number | null;
  realElapsedSeconds: number | null;
  // Tarea o subtarea de Jira ya creada para el punto (10C)
  issueKey: string | null;
}

export type PointsModel =
  | { kind: 'ready'; id: string; name: string; rows: PointRow[] }
  | { kind: 'missing'; id: string; name: string }
  | { kind: 'invalid'; id: string; name: string; message: string };

// Al volver de Claude: la pantalla de puntos pregunta si ese punto se terminó
export interface PointFinishTarget {
  analysisId: string;
  pointId: string;
}

// notice: el punto cambió en jm pero Jira no se movió (se avisa, no se bloquea)
export type PointStartOutcome =
  { kind: 'ok'; notice?: string } | { kind: 'needs-reopen' } | { kind: 'failed'; message: string };

// Los puntos del análisis son tareas solo de jm (sin Jira): el dev las inicia una a una
export interface AnalysisPointsBridge {
  load: (id: string) => Promise<PointsModel>;
  start: (id: string, pointId: string, options: { reopen?: boolean }) => Promise<PointStartOutcome>;
  // Devuelven un aviso si el punto está vinculado y Jira no se movió; null si todo quedó bien
  finish: (id: string, pointId: string) => Promise<string | null>;
  // Transiciones de Jira para devolver un punto vinculado; vacío si no está vinculado o Jira no respondió
  returnOptions: (id: string, pointId: string) => Promise<string[]>;
  giveBack: (id: string, pointId: string, transitionName?: string) => Promise<string | null>;
}

// Destino posible de los puntos: la épica (tareas) o una historia (subtareas)
export interface LinkTarget {
  key: string;
  summary: string;
  childKind: 'standard' | 'subtask';
}

export type LinkTargetOutcome = { ok: true; target: LinkTarget } | { ok: false; message: string };

export interface LinkModel {
  epicKey: string | null;
  points: PointsModel;
}

export interface LinkPointResult {
  pointId: string;
  ok: boolean;
  issueKey?: string;
  // Fallo, o aviso si se creó pero el estado no pasó a Jira
  message?: string;
}

export interface AnalysisLinkBridge {
  load: (id: string) => Promise<LinkModel>;
  // epicKey: solo una épica del proyecto; null quita la épica
  resolveTarget: (id: string, key: string, mustBeEpic: boolean) => Promise<LinkTargetOutcome>;
  setEpic: (id: string, epicKey: string | null) => Promise<void>;
  // pointId -> clave del destino; crea solo lo que falta
  create: (id: string, targets: Record<string, string>) => Promise<LinkPointResult[]>;
}

export interface AnalysisBridge {
  points: AnalysisPointsBridge;
  link: AnalysisLinkBridge;
  create: (input: NewAnalysisInput) => Promise<CreateAnalysisOutcome>;
  load: (id: string) => Promise<AnalysisDetail>;
  addSources: (id: string, input: SourcesInput) => Promise<AddSourcesOutcome>;
  trackingStatus: (id: string) => Promise<PlanningStatus>;
  trackingSuggestion: () => Promise<PlanningSuggestion>;
  // whereKey: épica o historia elegida a mano; null = la de gestión del proyecto
  createTracking: (id: string, input: PlanningInput, whereKey: string | null) => Promise<PlanningOutcome>;
  // Borra la carpeta del análisis; se niega si ya tiene tarea en Jira
  remove: (id: string) => Promise<RemoveAnalysisOutcome>;
}
