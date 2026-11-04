import type { ChatBridge, ChatHeader, ChatLine, ChatUiEvent } from '../refinement/chat-types.js';

const WAIT_TIMEOUT_MS = 2000;
const WAIT_POLL_MS = 15;

// Espera a que se cumpla una condición (el render y los puentes falsos son asíncronos)
export async function waitFor(condition: () => boolean, what = 'la condición', timeoutMs = WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Se agotó el tiempo esperando ${what}`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

export const BASE_HEADER: ChatHeader = {
  key: 'AQ-45',
  phase: 'debate',
  phaseLabel: 'debate',
  blockLabel: 'riesgos',
  model: 'sonnet',
  contextTokens: 42_300,
  costUsd: 0.05,
  tooLong: false,
};

export interface FakeChatOptions {
  needsFolder?: boolean;
  saveError?: string;
  suggestedFolder?: string | null;
  codeFolder?: string | null;
}

// Puente de chat falso para las pruebas de la app: no lanza claude
export function createFakeChat(
  header: Partial<ChatHeader> = {},
  history: ChatLine[] = [],
  options: FakeChatOptions = {},
) {
  const sent: string[] = [];
  const calls = {
    opened: [] as string[],
    toggle: 0,
    newSession: 0,
    close: 0,
    saved: [] as Array<{ projectKey: string; folder: string }>,
    skipped: [] as string[],
    checks: [] as boolean[],
  };
  let needsFolder = options.needsFolder ?? false;
  let listener: ((event: ChatUiEvent) => void) | null = null;
  const chat: ChatBridge = {
    checkCodeFolder: async (key, force = false) => {
      calls.checks.push(force);
      const suggestedFolder = options.suggestedFolder ?? options.codeFolder ?? null;
      return needsFolder || force
        ? { status: 'needs-folder', projectKey: key.split('-')[0], suggestedFolder, confirmCwd: !options.codeFolder }
        : { status: 'ready', codeFolder: options.codeFolder ?? null };
    },
    saveCodeFolder: async (projectKey, folder) => {
      if (options.saveError) return { ok: false, message: options.saveError };
      calls.saved.push({ projectKey, folder });
      needsFolder = false;
      return { ok: true };
    },
    skipCodeFolder: (projectKey) => {
      calls.skipped.push(projectKey);
      needsFolder = false;
    },
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
