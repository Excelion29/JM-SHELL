import * as fs from 'fs-extra';
import type { ChatKnowledge, ChatLine } from './chat-types';
import { buildChatSettings, EXPLORER_AGENTS } from './claude-chat';
import { CHAT_FILE, updateState } from './state';
import type { StoryStore } from './story-store';
import { KB_SERVER_NAME } from './kb-proxy';
import { stripTerminalControls } from './text';
import { addTurnUsage, TurnUsage } from './usage';
import { CHAT_FILES, removeWorkFile, writeWorkFile } from './workdir';

// La copia de la conversación no crece sin tope: al abrir se queda con lo más reciente
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
      return isChatLine(parsed) ? [{ role: parsed.role, text: stripTerminalControls(parsed.text), at: parsed.at }] : [];
    } catch {
      return []; // una línea cortada por un cierre brusco no debe tumbar el historial
    }
  });
}

function tailOf(text: string): string {
  if (Buffer.byteLength(text) <= TRANSCRIPT_MAX_BYTES) return text;
  const tail = Buffer.from(text).subarray(-TRANSCRIPT_MAX_BYTES).toString('utf8');
  // la primera línea queda cortada: se descarta
  return tail.slice(tail.indexOf('\n') + 1);
}

export async function readTranscript(store: StoryStore, limit: number): Promise<ChatLine[]> {
  const text = await store.readText(CHAT_FILE);
  return text === null ? [] : parseLines(tailOf(text)).slice(-limit);
}

// Solo al abrir: si el archivo pasó el tope se reescribe con lo más reciente (agregar nunca relee ni reescribe)
export async function openTranscript(store: StoryStore, limit: number): Promise<ChatLine[]> {
  const entries = await readTranscript(store, TRANSCRIPT_MAX_ENTRIES + 1);
  if (entries.length > TRANSCRIPT_MAX_ENTRIES) {
    const kept = entries.slice(-TRANSCRIPT_MAX_ENTRIES);
    await store.writeText(CHAT_FILE, `${kept.map((e) => JSON.stringify(e)).join('\n')}\n`);
    return kept.slice(-limit);
  }
  return entries.slice(-limit);
}

export const appendTranscript = (store: StoryStore, entry: ChatLine): Promise<void> =>
  store.append(CHAT_FILE, `${JSON.stringify(entry)}\n`);

export async function recordTurnUsage(store: StoryStore, key: string, turn: TurnUsage, costUsd: number): Promise<void> {
  await updateState(store, key, (state) => {
    state.usage = addTurnUsage(state.usage, turn, costUsd);
  });
}

// Se escribe siempre: es contenido fijo de jm y así `--agents` recibe una ruta, no JSON por argv
export function writeAgentsFile(workDir: string): string {
  return writeWorkFile(workDir, CHAT_FILES.agents, `${JSON.stringify(EXPLORER_AGENTS, null, 2)}\n`);
}

// La skill viaja desde la carpeta de trabajo: su ruta de instalación puede tener tildes o paréntesis que argv no admite
export function writeSkillCopy(workDir: string, skillSource: string): string {
  return writeWorkFile(workDir, CHAT_FILES.skill, fs.readFileSync(skillSource, 'utf8'));
}

// Se regenera en cada arranque: refleja la clave de la historia y no depende de lo que haya en disco
export function writeClaudeSettings(workDir: string, key: string, kb: ChatKnowledge | null = null): string {
  return writeWorkFile(workDir, CHAT_FILES.settings, `${JSON.stringify(buildChatSettings(key, kb), null, 2)}\n`);
}

// Apunta al intermediario local: ni la API key ni el certificado viajan en este archivo (el puerto cambia en cada arranque)
export function writeMcpConfig(workDir: string, proxyUrl: string): string {
  const config = { mcpServers: { [KB_SERVER_NAME]: { type: 'http', url: proxyUrl } } };
  return writeWorkFile(workDir, CHAT_FILES.mcp, `${JSON.stringify(config, null, 2)}\n`);
}

// Al abrir Claude completo viaja como prompt de sistema; se borra cuando ya no hay base conectada
export function writeKnowledgeContext(workDir: string, context: string | null): void {
  if (context === null) removeWorkFile(workDir, CHAT_FILES.context);
  else writeWorkFile(workDir, CHAT_FILES.context, `${context}\n`);
}
