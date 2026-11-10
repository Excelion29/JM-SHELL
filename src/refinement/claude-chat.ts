import { randomUUID } from 'crypto';
import * as path from 'path';
import type { ChatKnowledge, ChatModel } from './chat-types';
import {
  ANALYSIS_KEY_SOURCE,
  analysisDenyRules,
  assertSafeArgs,
  CHAT_DISALLOWED_TOOLS,
  CHAT_KEY_SOURCE,
  CHAT_MODEL_NAMES,
  chatAllowedTools,
  isAnalysisKey,
  scopedKnowledgeRules,
  SESSION_ID_PATTERN,
  spawnClaude,
} from './claude';
import { stripControlChars, stripTerminalControls } from './text';
import { emptyTurnUsage, TurnUsage } from './usage';

export const MODELS = { conversation: 'sonnet', explorer: 'haiku', deep: 'opus' } as const satisfies Record<
  string,
  ChatModel
>;

// Un --resume con sesión inexistente termina casi al instante con código != 0
const RESUME_FAIL_WINDOW_MS = 5000;
// Cómo avisa Claude Code de que la sesión a retomar no existe ("No conversation found with session ID")
const SESSION_NOT_FOUND_PATTERN = /No conversation found|session .{0,60}not found|no such session/i;
// Si el hijo no cierra solo tras cerrar su stdin, se corta para no dejar procesos huérfanos
const CLOSE_GRACE_MS = 60_000;
const TARGET_MAX_CHARS = 80;
const STDERR_TAIL_CHARS = 300;
const KEY_PATTERN = new RegExp(`^(${CHAT_KEY_SOURCE}|${ANALYSIS_KEY_SOURCE})$`);
// Una línea sin salto de línea más larga que esto es basura o un fallo: se descarta
const NDJSON_BUFFER_MAX_CHARS = 8 * 1024 * 1024;
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

const withContext = (message: string, context: string | null) => (context ? `${message} ${context}` : message);

export const CHAT_MESSAGES = {
  first: (key: string, context: string | null = null) =>
    withContext(`Sigue la skill refinar para la historia ${key}.`, context),
  fromLog: (key: string, context: string | null = null) =>
    withContext(
      `Esta es una sesión nueva de la historia ${key}. Retoma desde bitacora.md y estado.json: resume en 2 líneas lo decidido y sigue en el bloque actual.`,
      context,
    ),
  fromNote: (key: string, context: string) =>
    `Sigue la skill refinar para la historia ${key}. Es la primera vez en esta carpeta, pero la base de conocimiento ya tiene una nota de esta historia: léela primero, resume en 2 líneas lo decidido y sigue desde ahí. ${context}`,
  // Primer mensaje real del dev cuando hay que reconstruir el contexto en una sesión nueva
  withUserText: (recovery: string, text: string) => `${recovery}

Mensaje del dev: ${text}`,
} as const;

export const ANALYSIS_MESSAGES = {
  first: (id: string, name: string, context: string | null = null) =>
    withContext(`Sigue la skill analizar para el análisis ${id} (${name}).`, context),
  fromLog: (id: string, context: string | null = null) =>
    withContext(
      `Esta es una sesión nueva del análisis ${id}. Retoma desde bitacora.md y estado.json: resume en 2 líneas lo decidido y sigue en el bloque actual.`,
      context,
    ),
} as const;

export const EXPLORER_AGENTS = {
  explorador: {
    description: 'Explora el código del proyecto en solo lectura y devuelve un mapa archivo:línea de lo relevante.',
    prompt:
      'Eres un explorador de código de solo lectura. Busca con Grep, Glob y Read lo que te pidan y responde corto: ' +
      'una lista de archivo:línea con una frase por cada hallazgo. No propongas cambios ni escribas archivos.',
    tools: ['Read', 'Grep', 'Glob'],
    model: MODELS.explorer,
  },
} as const;

export type ChatEvent =
  | { type: 'textDelta'; text: string }
  | { type: 'assistantText'; text: string }
  | { type: 'toolActivity'; tool: string; target: string }
  | { type: 'turnEnd'; usage: TurnUsage; costUsd: number; isError: boolean }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null };

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const clean = (text: string) => stripControlChars(text).slice(0, TARGET_MAX_CHARS);

function toolTarget(tool: string, input: unknown): string {
  if (!isRaw(input)) return '';
  const candidates = SUBAGENT_TOOLS.has(tool)
    ? [input.subagent_type, input.description]
    : [input.file_path, input.path, input.pattern, input.description];
  const found = candidates.find((value): value is string => typeof value === 'string' && value !== '');
  return found ? stripControlChars(found) : '';
}

function fromAssistant(raw: Raw): ChatEvent[] {
  const message = raw.message;
  if (!isRaw(message) || !Array.isArray(message.content)) return [];
  const fromSubagent = typeof raw.parent_tool_use_id === 'string';
  const events: ChatEvent[] = [];
  for (const block of message.content) {
    if (!isRaw(block)) continue;
    const text = block.type === 'text' && typeof block.text === 'string' ? stripTerminalControls(block.text) : '';
    if (text !== '' && !fromSubagent) {
      events.push({ type: 'assistantText', text });
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      events.push({ type: 'toolActivity', tool: clean(block.name), target: toolTarget(block.name, block.input) });
    }
  }
  return events;
}

function fromStream(raw: Raw): ChatEvent[] {
  const event = raw.event;
  if (typeof raw.parent_tool_use_id === 'string' || !isRaw(event) || event.type !== 'content_block_delta') return [];
  const delta = event.delta;
  if (!isRaw(delta) || delta.type !== 'text_delta' || typeof delta.text !== 'string') return [];
  const text = stripTerminalControls(delta.text);
  return text === '' ? [] : [{ type: 'textDelta', text }];
}

function fromResult(raw: Raw): ChatEvent[] {
  const usage = isRaw(raw.usage) ? raw.usage : {};
  return [
    {
      type: 'turnEnd',
      usage: {
        ...emptyTurnUsage(),
        inputTokens: num(usage.input_tokens),
        outputTokens: num(usage.output_tokens),
        cacheReadTokens: num(usage.cache_read_input_tokens),
        cacheCreationTokens: num(usage.cache_creation_input_tokens),
      },
      costUsd: num(raw.total_cost_usd),
      isError: raw.is_error === true || raw.subtype !== 'success',
    },
  ];
}

export function toChatEvents(raw: unknown): ChatEvent[] {
  if (!isRaw(raw)) return [];
  if (raw.type === 'stream_event') return fromStream(raw);
  if (raw.type === 'assistant') return fromAssistant(raw);
  if (raw.type === 'result') return fromResult(raw);
  return [];
}

export interface NdjsonParser {
  push: (chunk: string) => void;
  flush: () => void;
  readonly ignoredLines: number;
}

// Las líneas que no son JSON se descartan y se cuentan; nunca se imprimen (la terminal es de la app)
export function createNdjsonParser(onEvent: (event: ChatEvent) => void): NdjsonParser {
  let buffer = '';
  let ignored = 0;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    try {
      toChatEvents(JSON.parse(line)).forEach(onEvent);
    } catch {
      ignored += 1;
    }
  };
  return {
    push(chunk) {
      buffer += chunk;
      let start = 0;
      let index = buffer.indexOf('\n', start);
      while (index >= 0) {
        handleLine(buffer.slice(start, index));
        start = index + 1;
        index = buffer.indexOf('\n', start);
      }
      buffer = buffer.slice(start);
      if (buffer.length > NDJSON_BUFFER_MAX_CHARS) {
        buffer = '';
        onEvent({ type: 'error', message: 'Claude envió una línea demasiado larga y la descarté.' });
      }
    },
    flush() {
      handleLine(buffer);
      buffer = '';
    },
    get ignoredLines() {
      return ignored;
    },
  };
}

// Ajustes que jm le pasa a claude: sin hooks y con los mismos permisos que el allowlist de argv
export function buildChatSettings(key: string, kb: ChatKnowledge | null = null): Record<string, unknown> {
  if (!KEY_PATTERN.test(key)) throw new Error(`Clave inválida para el chat: "${key}".`);
  return {
    disableAllHooks: true,
    permissions: {
      allow: [...chatAllowedTools(key, kb).split(','), ...scopedKnowledgeRules(kb, key)],
      deny: [...CHAT_DISALLOWED_TOOLS.split(','), ...analysisDenyRules(kb, key)],
    },
  };
}

export interface ChatArgsInput {
  key: string;
  model: ChatModel;
  sessionId: string;
  resume: boolean;
  skillFile: string;
  agentsFile: string;
  settingsFile: string;
  kb?: ChatKnowledge | null;
  // Solo con MCP: el mcp.json de la carpeta de trabajo y las copias de solo lectura de los adjuntos
  mcpFile?: string;
  attachmentsDir?: string;
}

function knowledgeArgs(kb: ChatKnowledge | null, mcpFile?: string, attachmentsDir?: string): string[] {
  if (kb?.type === 'mcp') {
    if (!mcpFile || !attachmentsDir) throw new Error('Falta la carpeta de trabajo para la base de conocimiento.');
    return ['--mcp-config', mcpFile, '--add-dir', attachmentsDir];
  }
  return kb?.type === 'local' ? ['--add-dir', kb.root] : [];
}

// El texto del dev nunca: viaja por stdin. Todo lo de abajo lo genera jm.
export function buildChatArgs({
  key,
  model,
  sessionId,
  resume,
  skillFile,
  agentsFile,
  settingsFile,
  kb = null,
  mcpFile,
  attachmentsDir,
}: ChatArgsInput): string[] {
  if (!KEY_PATTERN.test(key)) throw new Error(`Clave inválida para el chat: "${key}".`);
  if (!CHAT_MODEL_NAMES.includes(model)) throw new Error(`Modelo no permitido para el chat: "${model}".`);
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('Id de sesión inválido para el chat.');
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    ...knowledgeArgs(kb, mcpFile, attachmentsDir),
    '--settings',
    settingsFile,
    '--permission-mode',
    'dontAsk',
    '--model',
    model,
    '--allowedTools',
    chatAllowedTools(key, kb),
    '--disallowedTools',
    CHAT_DISALLOWED_TOOLS,
    '--agents',
    agentsFile,
    '--append-system-prompt-file',
    skillFile,
    resume ? '--resume' : '--session-id',
    sessionId,
  ];
}

export interface ChatProcess {
  write: (line: string) => void;
  end: () => void;
  kill: () => void;
  onData: (listener: (chunk: string) => void) => void;
  onStderr: (listener: (chunk: string) => void) => void;
  onExit: (listener: (code: number | null) => void) => void;
  onError: (listener: (error: Error) => void) => void;
}

export type ChatSpawner = (args: string[], cwd: string) => ChatProcess;

export const spawnChatProcess: ChatSpawner = (args, cwd) => {
  const child = spawnClaude(args, cwd, ['pipe', 'pipe', 'pipe']);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  const errorListeners: Array<(error: Error) => void> = [];
  const fail = (error: Error) => errorListeners.forEach((listener) => listener(error));
  // EPIPE al escribir en un hijo que ya murió llega como evento: sin este handler tumbaría jm
  child.stdin?.on('error', fail);
  child.on('error', fail);
  return {
    write: (line) => {
      if (!child.stdin?.writable) throw new Error('El proceso de Claude ya no acepta mensajes.');
      child.stdin.write(line);
    },
    end: () => void child.stdin?.end(),
    kill: () => void child.kill(),
    onData: (listener) => void child.stdout?.on('data', listener),
    onStderr: (listener) => void child.stderr?.on('data', listener),
    onExit: (listener) => void child.on('close', listener),
    onError: (listener) => void errorListeners.push(listener),
  };
};

export interface ChatSessionOptions {
  root: string;
  skillFile: string;
  agentsFile: string;
  settingsFile: string;
  saveSessionId: (sessionId: string) => Promise<void> | void;
  kb?: ChatKnowledge | null;
  mcpFile?: string;
  attachmentsDir?: string;
  // Nombre del análisis: solo lo usa el mensaje inicial de un análisis
  subjectName?: string;
  // Línea de contexto de la base de conocimiento que acompaña a los mensajes iniciales
  kbContext?: string | null;
  spawner?: ChatSpawner;
  newSessionId?: () => string;
  now?: () => number;
}

export interface ChatStartOptions {
  key: string;
  sessionId: string | null;
  model: ChatModel;
  // Cómo abrir una sesión sin id guardado: desde cero, desde la bitácora o desde la nota de la base
  startMessage?: 'first' | 'fromLog' | 'fromNote';
  // Hay conversación previa (sesión guardada o historial): no se envía nada hasta el primer mensaje del dev
  hasHistory?: boolean;
}

type Listener = (event: ChatEvent) => void;

export class ChatSession {
  private readonly spawner: ChatSpawner;
  private readonly newSessionId: () => string;
  private readonly now: () => number;
  private listener: Listener = () => undefined;
  private process: ChatProcess | null = null;
  private key = '';
  private sessionId = '';
  private model: ChatModel = MODELS.conversation;
  private busy = false;
  // Evita lanzar procesos tras cerrar mientras una apertura espera en saveSessionId
  private closed = false;
  // Conversación reabierta sin proceso: el primer send() la retoma
  private awaitingFirstMessage = false;
  private recoveryMessage = '';

  constructor(private readonly options: ChatSessionOptions) {
    this.spawner = options.spawner ?? spawnChatProcess;
    this.newSessionId = options.newSessionId ?? randomUUID;
    this.now = options.now ?? Date.now;
  }

  onEvent(listener: Listener): void {
    this.listener = listener;
  }

  get currentModel(): ChatModel {
    return this.model;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get isAwaitingFirstMessage(): boolean {
    return this.awaitingFirstMessage;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  async start({ key, sessionId, model, startMessage = 'first', hasHistory = false }: ChatStartOptions): Promise<void> {
    this.key = key;
    this.model = model;
    this.closed = false;
    this.awaitingFirstMessage = false;
    if (sessionId || hasHistory) {
      this.sessionId = sessionId ?? '';
      this.recoveryMessage = this.messageFor(startMessage === 'fromNote' ? 'fromNote' : 'fromLog');
      this.awaitingFirstMessage = true;
      return;
    }
    await this.startFresh(this.messageFor(startMessage));
  }

  // Sesión nueva (otro uuid) que retoma desde la bitácora en lugar de arrastrar el contexto
  async startFromLog(): Promise<void> {
    this.detach(true);
    this.awaitingFirstMessage = false;
    await this.startFresh(this.fromLogMessage());
  }

  send(text: string): void {
    if (this.awaitingFirstMessage) {
      this.openWith(text);
      return;
    }
    if (!this.process) throw new Error('La conversación no está abierta.');
    this.busy = true;
    try {
      this.process.write(this.userLine(text));
    } catch (err: unknown) {
      this.busy = false;
      throw new Error(`No pude enviar el mensaje: ${(err as Error).message}`);
    }
  }

  // Misma sesión, otro modelo: Claude solo cambia de modelo al arrancar, así que se retoma con --resume
  switchModel(model: ChatModel): void {
    if (model === this.model) return;
    if (this.awaitingFirstMessage) {
      this.model = model;
      return;
    }
    if (this.busy) {
      this.listener({ type: 'error', message: 'Espera a que termine la respuesta para cambiar de modelo.' });
      return;
    }
    this.detach(true);
    this.model = model;
    this.launch(true, null);
  }

  // force=false deja terminar la vuelta en curso y el hijo sale solo al cerrarse su stdin
  close(force = false): void {
    this.closed = true;
    this.detach(force);
  }

  private get context(): string | null {
    return this.options.kbContext ?? null;
  }

  private messageFor(startMessage: 'first' | 'fromLog' | 'fromNote'): string {
    if (startMessage === 'fromLog') return this.fromLogMessage();
    if (isAnalysisKey(this.key))
      return ANALYSIS_MESSAGES.first(this.key, this.options.subjectName ?? this.key, this.context);
    if (startMessage === 'fromNote' && this.context) return CHAT_MESSAGES.fromNote(this.key, this.context);
    return CHAT_MESSAGES.first(this.key, this.context);
  }

  private fromLogMessage(): string {
    return isAnalysisKey(this.key)
      ? ANALYSIS_MESSAGES.fromLog(this.key, this.context)
      : CHAT_MESSAGES.fromLog(this.key, this.context);
  }

  private openWith(text: string): void {
    this.awaitingFirstMessage = false;
    this.busy = true;
    const recovery = CHAT_MESSAGES.withUserText(this.recoveryMessage, text);
    if (this.sessionId) {
      this.launch(true, withContext(text, this.context), recovery);
      return;
    }
    this.startFresh(recovery).catch((err: unknown) => {
      this.busy = false;
      this.listener({ type: 'error', message: `No pude abrir una sesión nueva: ${(err as Error).message}` });
    });
  }

  private async startFresh(firstMessage: string): Promise<void> {
    this.sessionId = this.newSessionId();
    await this.options.saveSessionId(this.sessionId);
    if (this.closed) return;
    this.launch(false, firstMessage);
  }

  private userLine = (text: string) =>
    `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

  private detach(force: boolean): void {
    const current = this.process;
    this.process = null;
    this.busy = false;
    if (!current) return;
    current.end();
    if (force) {
      current.kill();
      return;
    }
    setTimeout(() => current.kill(), CLOSE_GRACE_MS).unref();
  }

  private launch(resume: boolean, firstMessage: string | null, fallbackMessage = this.fromLogMessage()): void {
    const args = buildChatArgs({
      key: this.key,
      model: this.model,
      sessionId: this.sessionId,
      resume,
      skillFile: this.options.skillFile,
      agentsFile: this.options.agentsFile,
      settingsFile: this.options.settingsFile,
      kb: this.options.kb,
      mcpFile: this.options.mcpFile,
      attachmentsDir: this.options.attachmentsDir,
    });
    assertSafeArgs(args);
    let sawOutput = false;
    // Con sesión inexistente el CLI real emite un result de error (0 vueltas) antes de salir: se retiene hasta
    // saber si toca abrir una sesión nueva, para no mostrar un error que el respaldo va a resolver
    let heldErrorEnd: ChatEvent | null = null;
    // total_cost_usd es acumulado por proceso (verificado con 2 vueltas reales): se registra la diferencia
    let lastTotalCost = 0;
    const parser = createNdjsonParser((event) => {
      if (event.type === 'turnEnd' && event.isError && resume && firstMessage !== null && !sawOutput) {
        heldErrorEnd = event;
        return;
      }
      sawOutput = true;
      if (event.type !== 'turnEnd') return this.handle(proc, event);
      const delta = Math.max(0, event.costUsd - lastTotalCost);
      lastTotalCost = event.costUsd;
      this.handle(proc, { ...event, costUsd: delta });
    });
    const proc = this.spawner(args, this.options.root);
    this.process = proc;
    const started = this.now();
    let stderrTail = '';
    proc.onData((chunk) => parser.push(chunk));
    proc.onStderr((chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL_CHARS);
    });
    proc.onError((err) => this.handleFailure(proc, `No pude ejecutar claude: ${err.message}`));
    proc.onExit((code) => {
      parser.flush();
      if (this.process !== proc) return;
      this.process = null;
      this.busy = false;
      const sessionMissing =
        code !== 0 &&
        !sawOutput &&
        this.now() - started < RESUME_FAIL_WINDOW_MS &&
        SESSION_NOT_FOUND_PATTERN.test(stderrTail);
      if (resume && sessionMissing && firstMessage !== null) {
        void this.startFresh(fallbackMessage).catch((err: unknown) =>
          this.listener({ type: 'error', message: `No pude abrir una sesión nueva: ${(err as Error).message}` }),
        );
        return;
      }
      if (heldErrorEnd) this.handle(proc, heldErrorEnd);
      if (code !== 0 && stderrTail) {
        this.listener({ type: 'error', message: `Claude terminó con error: ${stripControlChars(stderrTail.trim())}` });
      }
      this.listener({ type: 'exit', code });
    });
    if (firstMessage !== null) {
      this.busy = true;
      this.write(proc, firstMessage);
    }
  }

  private write(proc: ChatProcess, text: string): void {
    try {
      proc.write(this.userLine(text));
    } catch (err: unknown) {
      this.handleFailure(proc, `No pude enviar el mensaje: ${(err as Error).message}`);
    }
  }

  private handle(source: ChatProcess, event: ChatEvent): void {
    if (this.process !== source) return;
    if (event.type === 'turnEnd') this.busy = false;
    if (event.type === 'toolActivity') {
      this.listener({ ...event, target: this.relativeTarget(event.target) });
      return;
    }
    this.listener(event);
  }

  private handleFailure(source: ChatProcess, message: string): void {
    if (this.process !== source) return;
    this.process = null;
    this.busy = false;
    source.kill();
    this.listener({ type: 'error', message });
  }

  private relativeTarget(target: string): string {
    const rooted = path.isAbsolute(target) ? path.relative(this.options.root, target) : target;
    // Se conserva el final de la ruta: es lo que identifica el archivo
    return (rooted.startsWith('..') ? target : rooted).slice(-TARGET_MAX_CHARS);
  }
}
