import * as fs from 'fs-extra';
import { promises as nodeFs } from 'fs';
import * as path from 'path';
import type { ChatKnowledge, ChatLine } from './chat-types';
import { buildChatSettings, EXPLORER_AGENTS } from './claude-chat';
import { CHAT_FILES } from './claude';
import { assertNoLinks, JM_DIR, lexists, safeEnsureDir, safeWriteFile } from './safe-fs';
import { KB_SERVER_NAME } from './kb-proxy';
import { agentsPath, chatPath, claudeSettingsPath, knowledgeContextPath, mcpConfigPath, updateState } from './state';
import { stripTerminalControls } from './text';
import { addTurnUsage, TurnUsage } from './usage';

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
      return isChatLine(parsed) ? [{ role: parsed.role, text: stripTerminalControls(parsed.text), at: parsed.at }] : [];
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

// La skill viaja relativa a la raíz: su ruta de instalación puede tener tildes o paréntesis que argv no admite
export function writeSkillCopy(root: string, skillSource: string): void {
  const file = path.join(root, CHAT_FILES.skill);
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, file, fs.readFileSync(skillSource, 'utf8'));
}

// Se regenera en cada arranque: refleja la clave de la historia y no depende de lo que haya en disco
export function writeClaudeSettings(root: string, key: string, kb: ChatKnowledge | null = null): string {
  const file = claudeSettingsPath(root);
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, file, `${JSON.stringify(buildChatSettings(key, kb), null, 2)}\n`);
  return file;
}

// Apunta al intermediario local: ni la API key ni el certificado viajan en este archivo (el puerto cambia en cada arranque)
export function writeMcpConfig(root: string, proxyUrl: string): void {
  const config = { mcpServers: { [KB_SERVER_NAME]: { type: 'http', url: proxyUrl } } };
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, mcpConfigPath(root), `${JSON.stringify(config, null, 2)}\n`);
}

// Al abrir Claude completo el prompt es solo "/refinar KEY": la skill lee de aquí dónde está la base y su nota
export function writeKnowledgeContext(root: string, context: string | null): void {
  const file = knowledgeContextPath(root);
  if (context === null) {
    if (lexists(file)) fs.removeSync(file);
    return;
  }
  safeEnsureDir(root, path.join(root, JM_DIR));
  safeWriteFile(root, file, `${context}\n`);
}
