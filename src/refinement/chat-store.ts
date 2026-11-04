import * as fs from 'fs-extra';
import { promises as nodeFs } from 'fs';
import * as path from 'path';
import type { ChatLine } from './chat-types';
import { buildChatSettings, EXPLORER_AGENTS } from './claude-chat';
import { assertNoLinks, JM_DIR, lexists, safeEnsureDir, safeWriteFile } from './safe-fs';
import { agentsPath, chatPath, claudeSettingsPath, updateState } from './state';
import { stripControlChars } from './text';
import { addTurnUsage, TurnUsage } from './usage';

// Mensajes que se muestran al reabrir una historia
export const TRANSCRIPT_HISTORY_LIMIT = 12;
// La copia local no crece sin tope: se queda con lo más reciente
export const TRANSCRIPT_MAX_ENTRIES = 500;
// Tope de lectura: un archivo más grande se lee solo por la cola
export const TRANSCRIPT_MAX_BYTES = 5 * 1024 * 1024;

const isChatLine = (value: unknown): value is ChatLine => {
  if (typeof value !== 'object' || value === null) return false;
  const { role, text, at } = value as Record<string, unknown>;
  return (role === 'user' || role === 'assistant') && typeof text === 'string' && typeof at === 'string';
};

function parseLines(content: string): ChatLine[] {
  return content.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed: unknown = JSON.parse(line);
      return isChatLine(parsed) ? [{ role: parsed.role, text: stripControlChars(parsed.text), at: parsed.at }] : [];
    } catch {
      return []; // una línea cortada por un cierre brusco no debe tumbar el historial
    }
  });
}

async function readTail(file: string): Promise<string> {
  const { size } = await fs.stat(file);
  if (size <= TRANSCRIPT_MAX_BYTES) return fs.readFile(file, 'utf8');
  const handle = await nodeFs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(TRANSCRIPT_MAX_BYTES);
    await handle.read(buffer, 0, TRANSCRIPT_MAX_BYTES, size - TRANSCRIPT_MAX_BYTES);
    const text = buffer.toString('utf8');
    // la primera línea queda cortada: se descarta
    return text.slice(text.indexOf('\n') + 1);
  } finally {
    await handle.close();
  }
}

export async function readTranscript(root: string, key: string, limit: number): Promise<ChatLine[]> {
  const file = chatPath(root, key);
  if (!lexists(file)) return [];
  assertNoLinks(root, file);
  return parseLines(await readTail(file)).slice(-limit);
}

// safe-fs solo ofrece escritura atómica: se relee y se reescribe el archivo completo
export async function appendTranscript(root: string, key: string, entry: ChatLine): Promise<void> {
  const entries = [...(await readTranscript(root, key, TRANSCRIPT_MAX_ENTRIES)), entry].slice(-TRANSCRIPT_MAX_ENTRIES);
  safeWriteFile(root, chatPath(root, key), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

export async function recordTurnUsage(root: string, key: string, turn: TurnUsage, costUsd: number): Promise<void> {
  await updateState(root, key, (state) => {
    state.usage = addTurnUsage(state.usage, turn, costUsd);
  });
}

// Se escribe siempre: es contenido fijo de jm y así `--agents` recibe una ruta, no JSON por argv
export function writeAgentsFile(root: string): string {
  const file = agentsPath(root);
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, file, `${JSON.stringify(EXPLORER_AGENTS, null, 2)}\n`);
  return file;
}

// Se regenera en cada arranque: refleja la clave de la historia y no depende de lo que haya en disco
export function writeClaudeSettings(root: string, key: string): string {
  const file = claudeSettingsPath(root);
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, file, `${JSON.stringify(buildChatSettings(key), null, 2)}\n`);
  return file;
}
