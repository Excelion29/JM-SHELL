// Contrato entre el puente (CJS) y la pantalla de chat (isla ESM): solo tipos, sin código en ejecución
import type { Phase } from './types';

export type ChatModel = 'sonnet' | 'haiku' | 'opus';

// Cómo llega la base de conocimiento a Claude: por el intermediario MCP o por una carpeta local
export type ChatKnowledge =
  | { type: 'mcp' }
  // adrDir: ruta absoluta con "/" de la carpeta JM-ADR, la única donde Claude escribe por su cuenta
  | { type: 'local'; root: string; adrDir: string };

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
  // Carpeta donde corre Claude: la de jm
  codeFolder: string;
  // La conversación ya existía: Claude no está trabajando y espera el primer mensaje del dev
  idle: boolean;
  history: ChatLine[];
  // Aviso al abrir (p. ej. la historia se movió a la base de conocimiento)
  notice?: string;
}

// Base de conocimiento: se pregunta una vez por carpeta que ya tiene proyecto
// 'untrusted': el .jira.json ya trae una base que el dev aún no confirmó en esta carpeta
export type KnowledgeStatus = 'unset' | 'set' | 'untrusted';

export interface KnowledgeSummary {
  type: 'mcp' | 'local';
  // URL del MCP o carpeta raíz local
  target: string;
  baseFolder: string;
}

export type KnowledgeConnection =
  { type: 'mcp'; url: string; apiKey: string; certPem: string | null } | { type: 'local'; root: string };

// 'current': la conexión ya guardada para esta carpeta; la API key nunca llega a la pantalla
export type KnowledgeTarget = KnowledgeConnection | { type: 'current' };

export type KnowledgeChoice = { type: 'none' } | { type: 'connect'; connection: KnowledgeTarget; baseFolder: string };

export interface KnowledgeSettings {
  type: 'none' | 'mcp' | 'local';
  // URL del MCP o carpeta raíz local; null sin base
  target: string | null;
  baseFolder: string | null;
  // Carpeta JM-ADR resuelta; null si la base no responde o no hay base
  adrFolder: string | null;
  // 'unreachable': hay base pero no se pudo leer (el motivo va en connectionError)
  connection: 'ok' | 'unreachable' | 'none';
  connectionError: string | null;
}

export interface KnowledgeChangeResult {
  // Historias que quedaron en la ubicación anterior; null si no se pudieron contar
  leftBehind: number | null;
  // Vienen de .jm del proyecto y la nueva config tiene base: se migran al abrirlas
  movesOnOpen?: boolean;
}

export interface KnowledgeEntryView {
  name: string;
  isFolder: boolean;
}

export interface KnowledgeListing {
  entries: KnowledgeEntryView[];
  // Carpeta JM-ADR que se usaría (existente o a crear) entre las carpetas listadas
  adrFolder: string;
}

export type ServerInspection = { tls: 'system' } | { tls: 'untrusted'; pem: string; fingerprint: string };

// Objeto plano que la isla ESM recibe como prop
export interface ChatBridge {
  open: (key: string, listener: (event: ChatUiEvent) => void) => Promise<ChatOpenResult>;
  send: (text: string) => void;
  toggleDeep: () => void;
  newSession: () => void;
  close: () => Promise<void>;
  knowledgeStatus: () => Promise<KnowledgeStatus>;
  inspectServer: (url: string) => Promise<ServerInspection>;
  listKnowledge: (connection: KnowledgeTarget, dir: string) => Promise<KnowledgeListing>;
  previewKnowledge: (connection: KnowledgeTarget, file: string) => Promise<string>;
  saveKnowledge: (choice: KnowledgeChoice) => Promise<void>;
  knowledgeSettings: () => Promise<KnowledgeSettings>;
  changeKnowledge: (choice: KnowledgeChoice) => Promise<KnowledgeChangeResult>;
  renewKnowledgeKey: (apiKey: string) => Promise<void>;
  describeKnowledge: () => Promise<KnowledgeSummary>;
  trustKnowledge: () => Promise<void>;
}
