// Contrato entre el puente (CJS) y la pantalla de chat (isla ESM): solo tipos, sin código en ejecución
import type { Phase } from './types';

export type ChatModel = 'sonnet' | 'haiku' | 'opus';

export interface ChatHeader {
  key: string;
  phase: Phase;
  phaseLabel: string;
  blockLabel: string;
  model: ChatModel;
  totalTokens: number;
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

// Objeto plano que la isla ESM recibe como prop
export interface ChatBridge {
  open: (key: string, listener: (event: ChatUiEvent) => void) => Promise<ChatOpenResult>;
  send: (text: string) => void;
  toggleDeep: () => void;
  newSession: () => void;
  close: () => Promise<void>;
}
