import type { ChatBridge, ChatHeader, ChatLine, ChatUiEvent } from '../refinement/chat-types.js';

export const BASE_HEADER: ChatHeader = {
  key: 'AQ-45',
  phase: 'debate',
  phaseLabel: 'debate',
  blockLabel: 'riesgos',
  model: 'sonnet',
  totalTokens: 1200,
  costUsd: 0.05,
  tooLong: false,
};

// Puente de chat falso para las pruebas de la app: no lanza claude
export function createFakeChat(header: Partial<ChatHeader> = {}, history: ChatLine[] = []) {
  const sent: string[] = [];
  const calls = { opened: [] as string[], toggle: 0, newSession: 0, close: 0 };
  let listener: ((event: ChatUiEvent) => void) | null = null;
  const chat: ChatBridge = {
    open: async (key, onEvent) => {
      listener = onEvent;
      calls.opened.push(key);
      return { header: { ...BASE_HEADER, ...header, key }, history };
    },
    send: (text) => void sent.push(text),
    toggleDeep: () => void (calls.toggle += 1),
    newSession: () => void (calls.newSession += 1),
    close: async () => void (calls.close += 1),
  };
  return { chat, sent, calls, header, emit: (event: ChatUiEvent) => listener?.(event) };
}
