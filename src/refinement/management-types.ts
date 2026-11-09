// Registro de gestión por tablero (parte 10A): la épica o historia donde cae el trabajo de análisis y coordinación

export interface ManagementIssue {
  key: string;
  summary: string;
}

// 'unset': nunca respondió · 'none': respondió que no tiene
export type ManagementStatus = 'unset' | 'none' | ManagementIssue;

export type ManagementSaveResult = { ok: true } | { ok: false; message: string };

// Por qué una de gestión ya no sirve para crear tareas dentro
export type ManagementProblem = 'done' | 'not-found' | 'subtask' | 'error';

export interface ManagementBridge {
  status: (projectKey: string) => Promise<ManagementStatus>;
  // key null: el dev no tiene una; si no, se valida en Jira (existe, no finalizada, no subtarea) antes de guardar
  save: (projectKey: string, key: string | null) => Promise<ManagementSaveResult>;
}
