// Análisis sin historia (parte 10B): estado guardado y contrato entre el puente (CJS) y las pantallas (isla ESM)
import type { PlanningInput, PlanningOutcome, PlanningStatus, PlanningSuggestion } from './tasks-types';
import type { PlanningTask, TaskRun } from './types';

// 10B-2 agrega las fases del debate
export type AnalysisPhase = 'sources';

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
  sources: AnalysisSource[];
  // Tareas de seguimiento "Análisis · <nombre> · fecha" en Jira (su tiempo vive en taskRuns)
  trackingTasks: PlanningTask[];
  taskRuns: Record<string, TaskRun>;
  // estado.json ilegible: aparece en el inicio con aviso y no cuenta para la calibración
  unreadable?: boolean;
}

export type SourceResult =
  | { source: string; ok: true; file: string }
  | { source: string; ok: false; message: string };

export interface SourcesInput {
  // Rutas absolutas separadas por coma, punto y coma o salto de línea; pueden venir entre comillas
  paths: string;
  // Texto pegado: se agrega a fuentes/texto.md
  text: string;
}

export interface NewAnalysisInput extends SourcesInput {
  name: string;
}

export type CreateAnalysisOutcome =
  { ok: true; id: string; results: SourceResult[] } | { ok: false; message: string };

export type AddSourcesOutcome = { ok: true; results: SourceResult[] } | { ok: false; message: string };

export interface AnalysisTrackingSummary {
  issueKey: string;
  status: TaskRun['status'];
}

export interface AnalysisDetail {
  id: string;
  name: string;
  sources: AnalysisSource[];
  tracking: AnalysisTrackingSummary[];
}

export interface AnalysisBridge {
  create: (input: NewAnalysisInput) => Promise<CreateAnalysisOutcome>;
  load: (id: string) => Promise<AnalysisDetail>;
  addSources: (id: string, input: SourcesInput) => Promise<AddSourcesOutcome>;
  trackingStatus: (id: string) => Promise<PlanningStatus>;
  trackingSuggestion: () => Promise<PlanningSuggestion>;
  // whereKey: épica o historia elegida a mano; null = la de gestión del proyecto
  createTracking: (id: string, input: PlanningInput, whereKey: string | null) => Promise<PlanningOutcome>;
}
