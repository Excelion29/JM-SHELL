// Contrato entre el puente (CJS) y la pantalla de chat (isla ESM): solo tipos, sin código en ejecución
import type { Phase } from './types';

export type ChatModel = 'sonnet' | 'haiku' | 'opus';

export interface ChatHeader {
  key: string;
  phase: Phase;
  phaseLabel: string;
  blockLabel: string;
  model: ChatModel;
  // Ventana de contexto usada en la última vuelta (0 si aún no hubo vuelta en esta sesión)
  contextTokens: number;
  costUsd: number;
  tooLong: boolean;
}

export interface ChatLine {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export type ChatUiEvent =
  | { type: 'textDelta'; text: string }
  | { type: 'assistantText'; text: string }
  | { type: 'activity'; tool: string; target: string }
  | { type: 'turnEnd'; header: ChatHeader }
  | { type: 'header'; header: ChatHeader }
  | { type: 'error'; message: string };

export interface ChatOpenResult {
  header: ChatHeader;
  history: ChatLine[];
}

export type CodeFolderCheck =
  | { status: 'ready'; codeFolder: string | null }
  | { status: 'needs-folder'; projectKey: string; suggestedFolder: string | null; confirmCwd: boolean };
export type SaveCodeFolderResult = { ok: true } | { ok: false; message: string };

// Objeto plano que la isla ESM recibe como prop
export interface ChatBridge {
  // Con `force` devuelve siempre needs-folder (cambiar un mapeo equivocado), sugiriendo el actual
  checkCodeFolder: (storyKey: string, force?: boolean) => Promise<CodeFolderCheck>;
  saveCodeFolder: (projectKey: string, folder: string) => Promise<SaveCodeFolderResult>;
  skipCodeFolder: (projectKey: string) => void;
  open: (key: string, listener: (event: ChatUiEvent) => void) => Promise<ChatOpenResult>;
  send: (text: string) => void;
  toggleDeep: () => void;
  newSession: () => void;
  close: () => Promise<void>;
}
