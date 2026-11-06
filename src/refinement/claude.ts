import { ChildProcess, spawn, StdioOptions } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ChatKnowledge, ChatModel } from './chat-types';
import { KB_ALLOWED_TOOLS, kbToolRule } from './kb-proxy';
import { CHAT_FILES, isWorkHashSegment, workBase, WORK_ATTACHMENTS_DIR } from './workdir';

export { CHAT_FILES };

const CLAUDE_BIN = 'claude';
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const SHELL_SHIM_EXTENSIONS = ['.cmd', '.bat'];
// Un --resume con sesión inexistente termina casi al instante con código != 0
const RESUME_FAIL_WINDOW_MS = 5000;

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const KEY_SOURCE = '[A-Z][A-Z0-9]+-\\d+';
// Mismo formato que ISSUE_KEY_STRICT de state.ts (que importa este módulo)
export const CHAT_KEY_SOURCE = '[A-Z][A-Z0-9_]+-\\d+';
export const CHAT_MODEL_NAMES: readonly ChatModel[] = ['sonnet', 'haiku', 'opus'];
export const CHAT_ALLOWED_TOOLS_BASE = 'Read,Grep,Glob,Task,Agent';
// Herramientas que siempre se niegan: la negación gana sobre cualquier allow
export const CHAT_DISALLOWED_TOOLS = 'Bash,WebFetch,WebSearch,NotebookEdit';
export const KB_MCP_RULES = KB_ALLOWED_TOOLS.map(kbToolRule).join(',');
// Con base conectada la historia vive en ella: nada se escribe en .jm del repositorio
export const chatAllowedTools = (key: string, kb?: ChatKnowledge | null) => {
  const local = kb ? '' : `,Write(.jm/historias/${key}/**),Edit(.jm/historias/${key}/**)`;
  return `${CHAT_ALLOWED_TOOLS_BASE}${local}${kb?.type === 'mcp' ? `,${KB_MCP_RULES}` : ''}`;
};
const RULE_DRIVE = /^([A-Za-z]):\//;
// Forma que Claude Code acepta para una ruta absoluta en Windows: //c/Users/... (con "C:/..." o barras invertidas no casa)
export const toRulePath = (absolutePath: string): string => {
  const slashed = absolutePath.replace(/\\/g, '/');
  const drive = RULE_DRIVE.exec(slashed);
  return drive ? `//${drive[1].toLowerCase()}/${slashed.slice(drive[0].length)}` : `/${slashed}`;
};
// Las reglas con ruta absoluta solo funcionan desde --settings (no desde --allowedTools)
// Solo la carpeta y la nota de la historia: el índice (00-indice.md) y las demás historias las escribe jm o nadie
export const scopedKnowledgeRules = (kb: ChatKnowledge | null | undefined, key: string): string[] => {
  if (kb?.type !== 'local') return [];
  const base = toRulePath(kb.adrDir);
  return ['Write', 'Edit'].flatMap((tool) => [`${tool}(${base}/${key}/**)`, `${tool}(${base}/${key}.md)`]);
};
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALLOWED_ARGS: RegExp[] = [
  /^(--session-id|--resume|-n)$/,
  SESSION_ID_PATTERN,
  new RegExp(`^refinar ${KEY_SOURCE}$`),
  new RegExp(`^/refinar ${KEY_SOURCE}$`),
  // Flags fijas del chat headless (el texto del dev viaja por stdin, nunca por argv)
  /^(-p|--verbose|--include-partial-messages|--strict-mcp-config)$/,
  /^(--input-format|--output-format|--setting-sources|--permission-mode|--model)$/,
  /^(--allowedTools|--disallowedTools|--agents|--settings|--append-system-prompt-file|--mcp-config|--add-dir)$/,
  // Valor vacío de --setting-sources: no carga ajustes de usuario, proyecto ni locales
  /^$/,
  new RegExp(`^(stream-json|dontAsk|${CHAT_MODEL_NAMES.join('|')})$`),
  new RegExp(`^${escapeRegex(CHAT_DISALLOWED_TOOLS)}$`),
  new RegExp(
    `^${escapeRegex(chatAllowedTools('KEY')).split('KEY').join(CHAT_KEY_SOURCE)}(,${escapeRegex(KB_MCP_RULES)})?$`,
  ),
  // Con base conectada la lista no incluye permisos sobre .jm
  new RegExp(`^${escapeRegex(CHAT_ALLOWED_TOOLS_BASE)}(,${escapeRegex(KB_MCP_RULES)})?$`),
  // Solo las herramientas MCP de la base: así se pasan al abrir Claude completo
  new RegExp(`^${escapeRegex(KB_MCP_RULES)}$`),
];

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const DOT_DOT_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
// Metacaracteres de cmd (el shim .cmd corre con shell) y barra final (rompería las comillas)
const SHELL_UNSAFE_PATH = /[%"!^&|<>\r\n]|[\\/]$/;

// Absoluta y normalizada: en Windows con unidad (sin UNC ni \\?\), sin "..", y path.resolve(p) === p
export function isNormalizedAbsolutePath(candidate: string, windows: boolean = IS_WINDOWS): boolean {
  if (DOT_DOT_SEGMENT.test(candidate)) return false;
  if (windows ? !WINDOWS_DRIVE_PATH.test(candidate) : !candidate.startsWith('/')) return false;
  return (windows ? path.win32 : path.posix).resolve(candidate) === candidate;
}

// Carpeta de la base local tras --add-dir
export const isSafeAddDirPath = (candidate: string, windows: boolean = IS_WINDOWS): boolean =>
  isNormalizedAbsolutePath(candidate, windows) && !SHELL_UNSAFE_PATH.test(candidate);
const ADD_DIR_FLAG = '--add-dir';
const CONFIG_FILE_FLAGS = new Set(['--settings', '--mcp-config', '--agents', '--append-system-prompt-file']);
const CHAT_FILE_NAMES: ReadonlySet<string> = new Set(Object.values(CHAT_FILES));
const WORK_FILE_DEPTH = 2;
const WORK_ATTACHMENTS_DEPTH = 3;
const CHAT_KEY_STRICT = new RegExp(`^${CHAT_KEY_SOURCE}$`);
// Base local confirmada por el dev para el proyecto abierto; openKnowledge la reinicia en cada apertura
const trustedAddDirs = new Set<string>();
export const trustAddDir = (root: string): void => {
  trustedAddDirs.clear();
  trustedAddDirs.add(root);
};
export const resetTrustedAddDirs = (): void => trustedAddDirs.clear();

// Archivo técnico de jm: <~/.jira-tool/trabajo>/<hash>/<archivo conocido>, nada más
export function isWorkFilePath(
  candidate: string,
  windows: boolean = IS_WINDOWS,
  base: string = workBase(),
): boolean {
  if (!isSafeAddDirPath(candidate, windows)) return false;
  const pathApi = windows ? path.win32 : path.posix;
  const parts = pathApi.relative(base, candidate).split(pathApi.sep);
  return parts.length === WORK_FILE_DEPTH && isWorkHashSegment(parts[0]) && CHAT_FILE_NAMES.has(parts[1]);
}

// Copias de adjuntos de la bóveda: <~/.jira-tool/trabajo>/<hash>/adjuntos/<CLAVE>, nada más
export function isAttachmentsDirPath(
  candidate: string,
  windows: boolean = IS_WINDOWS,
  base: string = workBase(),
): boolean {
  if (!isSafeAddDirPath(candidate, windows)) return false;
  const pathApi = windows ? path.win32 : path.posix;
  const parts = pathApi.relative(base, candidate).split(pathApi.sep);
  return (
    parts.length === WORK_ATTACHMENTS_DEPTH &&
    isWorkHashSegment(parts[0]) &&
    parts[1] === WORK_ATTACHMENTS_DIR &&
    CHAT_KEY_STRICT.test(parts[2])
  );
}

// Los valores de estas banderas son rutas: cada una se valida por su tipo, nunca contra la lista general
function isAllowedArg(flag: string | undefined, arg: string, workRoot: string): boolean {
  if (flag === ADD_DIR_FLAG) return trustedAddDirs.has(arg) || isAttachmentsDirPath(arg, IS_WINDOWS, workRoot);
  if (flag !== undefined && CONFIG_FILE_FLAGS.has(flag)) return isWorkFilePath(arg, IS_WINDOWS, workRoot);
  return ALLOWED_ARGS.some((pattern) => pattern.test(arg));
}

// La carpeta de trabajo va por argv a un shim con shell: sin % " ! ^ & | < > no hay cómo citarla
export function assertWorkDirUsable(workDir: string): void {
  if (!isSafeAddDirPath(workDir))
    throw new Error(
      `Tu carpeta de usuario tiene caracteres que Claude no admite en la línea de comandos (% " ! ^ & | < >): "${workDir}".`,
    );
}

export interface ClaudeRunResult {
  code: number | null;
  elapsedMs: number;
}

export type ClaudeRunner = (args: string[], cwd: string) => Promise<ClaudeRunResult>;

// Última barrera antes de spawn: ningún texto fuera de esta lista llega a un proceso
export function assertSafeArgs(args: string[], workRoot: string = workBase()): void {
  for (const [index, arg] of args.entries()) {
    const allowed = isAllowedArg(args[index - 1], arg, workRoot);
    if (!allowed) {
      throw new Error(`Argumento no permitido para claude: "${arg}".`);
    }
  }
}

export interface ResolvedExecutable {
  file: string;
  needsShell: boolean;
}

export function resolveExecutable(
  name: string,
  pathVar: string,
  pathExt: string = DEFAULT_PATHEXT,
  windows: boolean = IS_WINDOWS,
): ResolvedExecutable | null {
  // En Windows npm deja un `claude` sin extensión (script sh): solo valen las extensiones de PATHEXT
  const extensions = windows ? pathExt.split(';').filter(Boolean) : [''];
  // Entradas relativas del PATH (p. ej. ".") dejarían ejecutar un claude plantado en el cwd
  for (const dir of pathVar.split(path.delimiter).filter((entry) => path.isAbsolute(entry))) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return {
          file: candidate,
          needsShell: windows && SHELL_SHIM_EXTENSIONS.includes(path.extname(candidate).toLowerCase()),
        };
      }
    }
  }
  return null;
}

const resolveClaude = () =>
  resolveExecutable(CLAUDE_BIN, process.env.PATH ?? process.env.Path ?? '', process.env.PATHEXT);

export const isClaudeAvailable = (): boolean => resolveClaude() !== null;

// Con shim .cmd hace falta shell; los args ya pasaron la lista blanca (sin % " & | ^ < >)
const SHELL_ENV = { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' };
const quoteArg = (arg: string) => `"${arg}"`;

export function spawnClaude(args: string[], cwd: string, stdio: StdioOptions): ChildProcess {
  assertSafeArgs(args);
  const executable = resolveClaude();
  if (!executable) throw new Error('No encontré `claude` en el PATH.');
  const { file, needsShell } = executable;
  return needsShell
    ? spawn(quoteArg(file), args.map(quoteArg), { cwd, stdio, shell: true, env: SHELL_ENV })
    : spawn(file, args, { cwd, stdio });
}

export const runClaude: ClaudeRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    let child: ChildProcess;
    try {
      child = spawnClaude(args, cwd, 'inherit');
    } catch (err: unknown) {
      reject(err);
      return;
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, elapsedMs: Date.now() - started }));
  });

export const buildNewSessionArgs = (key: string, sessionId: string): string[] => [
  '--session-id',
  sessionId,
  '-n',
  `refinar ${key}`,
  `/refinar ${key}`,
];

export const buildResumeArgs = (sessionId: string): string[] => ['--resume', sessionId];

export interface WorkFiles {
  mcp: string;
  context: string;
  // Copias de solo lectura de los adjuntos de la bóveda (solo con MCP)
  attachments: string;
}

export const workFilesOf = (workDir: string, key: string): WorkFiles => ({
  mcp: path.join(workDir, CHAT_FILES.mcp),
  context: path.join(workDir, CHAT_FILES.context),
  attachments: path.join(workDir, WORK_ATTACHMENTS_DIR, key),
});

// Van antes del resto: --mcp-config, --add-dir y --allowedTools son variádicas y se tragarían el prompt final;
// el --append-system-prompt-file de cierre las corta
export const handoffKnowledgeArgs = (kb: ChatKnowledge | null, files: WorkFiles): string[] => {
  const context = ['--append-system-prompt-file', files.context];
  if (kb?.type === 'mcp')
    return [ADD_DIR_FLAG, files.attachments, '--mcp-config', files.mcp, '--allowedTools', KB_MCP_RULES, ...context];
  return kb?.type === 'local' ? [ADD_DIR_FLAG, kb.root, ...context] : [];
};

export interface LaunchOptions {
  key: string;
  existingSessionId: string | null;
  cwd: string;
  run: ClaudeRunner;
  saveSessionId: (sessionId: string) => Promise<void>;
  newSessionId?: () => string;
  extraArgs?: string[];
}

export async function launchClaude(options: LaunchOptions): Promise<void> {
  const { key, existingSessionId, cwd, run, saveSessionId, newSessionId = randomUUID, extraArgs = [] } = options;
  if (existingSessionId) {
    const result = await run([...extraArgs, ...buildResumeArgs(existingSessionId)], cwd);
    const resumed = result.code === 0 || result.elapsedMs >= RESUME_FAIL_WINDOW_MS;
    if (resumed) return;
  }
  const sessionId = newSessionId();
  await saveSessionId(sessionId);
  await run([...extraArgs, ...buildNewSessionArgs(key, sessionId)], cwd);
}
