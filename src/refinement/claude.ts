import { ChildProcess, spawn, StdioOptions } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ChatKnowledge, ChatModel } from './chat-types';
import { KB_ALLOWED_TOOLS, kbToolRule } from './kb-proxy';
import {
  CHAT_FILES,
  isWorkHashSegment,
  workBase,
  WORK_ANALYSIS_DIR,
  WORK_ATTACHMENTS_DIR,
  writeWorkFile,
} from './workdir';

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
// Id local de un análisis sin historia (nunca una clave de Jira); analysis.ts deriva su patrón de aquí
export const ANALYSIS_KEY_SOURCE = 'an-\\d{1,6}';
// Id de un punto del análisis (P1, P2, …): lo escribe Claude en puntos.json y viaja en el prompt de /ejecutar
export const POINT_ID_SOURCE = 'P\\d{1,4}';
export const ANALYSIS_DIR_NAME = 'analisis';
// Lo que Claude nunca escribe dentro de la carpeta de un análisis: el estado de jm (tareas de Jira, sesión) y las fuentes
export const ANALYSIS_STATE_NAME = 'estado.json';
export const ANALYSIS_SOURCES_NAME = 'fuentes';
const ANALYSIS_KEY_STRICT = new RegExp(`^${ANALYSIS_KEY_SOURCE}$`);
export const isAnalysisKey = (key: string): boolean => ANALYSIS_KEY_STRICT.test(key);
export const CHAT_MODEL_NAMES: readonly ChatModel[] = ['sonnet', 'haiku', 'opus'];
export const CHAT_ALLOWED_TOOLS_BASE = 'Read,Grep,Glob,Task,Agent';
// Herramientas que siempre se niegan: la negación gana sobre cualquier allow
export const CHAT_DISALLOWED_TOOLS = 'Bash,WebFetch,WebSearch,NotebookEdit';
export const KB_MCP_RULES = KB_ALLOWED_TOOLS.map(kbToolRule).join(',');
const allowedToolsFor = (writeScope: string, kb?: ChatKnowledge | null) => {
  const local = kb ? '' : `,Write(${writeScope}),Edit(${writeScope})`;
  return `${CHAT_ALLOWED_TOOLS_BASE}${local}${kb?.type === 'mcp' ? `,${KB_MCP_RULES}` : ''}`;
};
const STORY_WRITE_SCOPE = (key: string) => `.jm/historias/${key}/**`;
const ANALYSIS_WRITE_SCOPE = (key: string) => `.jm/${ANALYSIS_DIR_NAME}/${key}/**`;
// Con base conectada la historia o el análisis vive en ella: nada se escribe en .jm del repositorio
export const chatAllowedTools = (key: string, kb?: ChatKnowledge | null) =>
  allowedToolsFor(isAnalysisKey(key) ? ANALYSIS_WRITE_SCOPE(key) : STORY_WRITE_SCOPE(key), kb);
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
  // Un análisis solo escribe en su carpeta <JM-ADR>/analisis/<id>
  if (isAnalysisKey(key)) return ['Write', 'Edit'].map((tool) => `${tool}(${base}/${ANALYSIS_DIR_NAME}/${key}/**)`);
  return ['Write', 'Edit'].flatMap((tool) => [`${tool}(${base}/${key}/**)`, `${tool}(${base}/${key}.md)`]);
};
// Una regla deny gana sobre cualquier allow; con MCP lo mismo lo impone el intermediario (writeDenied)
export const analysisDenyRules = (kb: ChatKnowledge | null | undefined, key: string): string[] => {
  if (!isAnalysisKey(key) || kb?.type === 'mcp') return [];
  const folder =
    kb?.type === 'local' ? `${toRulePath(kb.adrDir)}/${ANALYSIS_DIR_NAME}/${key}` : `.jm/${ANALYSIS_DIR_NAME}/${key}`;
  return ['Write', 'Edit'].flatMap((tool) => [
    `${tool}(${folder}/${ANALYSIS_STATE_NAME})`,
    `${tool}(${folder}/${ANALYSIS_SOURCES_NAME}/**)`,
  ]);
};
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function analysisAllowedSource(): string {
  const [head, between, tail] = escapeRegex(allowedToolsFor(ANALYSIS_WRITE_SCOPE('KEY'))).split('KEY');
  return `${head}(${ANALYSIS_KEY_SOURCE})${between}\\1${tail}`;
}
const ALLOWED_ARGS: RegExp[] = [
  /^(--session-id|--resume|-n)$/,
  SESSION_ID_PATTERN,
  new RegExp(`^refinar ${KEY_SOURCE}$`),
  new RegExp(`^/refinar ${KEY_SOURCE}$`),
  // Ejecución de una tarea: historia + subtarea (iguales cuando la tarea no pertenece a una historia de jm)
  new RegExp(`^ejecutar ${CHAT_KEY_SOURCE}$`),
  new RegExp(`^/ejecutar ${CHAT_KEY_SOURCE} ${CHAT_KEY_SOURCE}$`),
  // Ejecución de un punto de análisis: id del análisis + id del punto
  new RegExp(`^ejecutar ${ANALYSIS_KEY_SOURCE} ${POINT_ID_SOURCE}$`),
  new RegExp(`^/ejecutar ${ANALYSIS_KEY_SOURCE} ${POINT_ID_SOURCE}$`),
  // Flags fijas del chat headless (el texto del dev viaja por stdin, nunca por argv)
  /^(-p|--verbose|--include-partial-messages|--strict-mcp-config)$/,
  /^(--input-format|--output-format|--setting-sources|--permission-mode|--model)$/,
  /^(--allowedTools|--disallowedTools|--agents|--settings|--append-system-prompt-file|--mcp-config|--add-dir)$/,
  // Valor vacío de --setting-sources: no carga ajustes de usuario, proyecto ni locales
  /^$/,
  new RegExp(`^(stream-json|dontAsk|${CHAT_MODEL_NAMES.join('|')})$`),
  new RegExp(`^${escapeRegex(CHAT_DISALLOWED_TOOLS)}$`),
  new RegExp(
    `^${escapeRegex(allowedToolsFor(STORY_WRITE_SCOPE('KEY')))
      .split('KEY')
      .join(CHAT_KEY_SOURCE)}(,${escapeRegex(KB_MCP_RULES)})?$`,
  ),
  // Write y Edit deben apuntar al mismo id (referencia )
  new RegExp(`^${analysisAllowedSource()}(,${escapeRegex(KB_MCP_RULES)})?$`),
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
const WORK_ANALYSIS_ATTACHMENTS_DEPTH = 4;
const CHAT_KEY_STRICT = new RegExp(`^${CHAT_KEY_SOURCE}$`);
// Base local confirmada por el dev para el proyecto abierto; openKnowledge la reinicia en cada apertura
const trustedAddDirs = new Set<string>();
export const trustAddDir = (root: string): void => {
  trustedAddDirs.clear();
  trustedAddDirs.add(root);
};
export const resetTrustedAddDirs = (): void => trustedAddDirs.clear();

// Archivo técnico de jm: <~/.jira-tool/trabajo>/<hash>/<archivo conocido>, nada más
export function isWorkFilePath(candidate: string, windows: boolean = IS_WINDOWS, base: string = workBase()): boolean {
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
  if (!isWorkHashSegment(parts[0]) || parts[1] !== WORK_ATTACHMENTS_DIR) return false;
  if (parts.length === WORK_ATTACHMENTS_DEPTH) return CHAT_KEY_STRICT.test(parts[2]);
  // Los análisis van en su propia subcarpeta: an-1 y AN-1 serían la misma carpeta en NTFS
  return (
    parts.length === WORK_ANALYSIS_ATTACHMENTS_DEPTH &&
    parts[2] === WORK_ANALYSIS_DIR &&
    ANALYSIS_KEY_STRICT.test(parts[3])
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

export type ClaudeCommand = 'refinar' | 'ejecutar';

// Un punto (P1) se repite entre análisis: su nombre de sesión lleva el análisis
const taskLabel = (key: string, issueKey: string): string => (isAnalysisKey(key) ? `${key} ${issueKey}` : issueKey);

export const buildNewSessionArgs = (
  key: string,
  sessionId: string,
  command: ClaudeCommand = 'refinar',
  issueKey: string = key,
): string[] =>
  command === 'refinar'
    ? ['--session-id', sessionId, '-n', `refinar ${key}`, `/refinar ${key}`]
    : ['--session-id', sessionId, '-n', `ejecutar ${taskLabel(key, issueKey)}`, `/ejecutar ${key} ${issueKey}`];

export const buildResumeArgs = (sessionId: string): string[] => ['--resume', sessionId];

export interface WorkFiles {
  mcp: string;
  context: string;
  // Ajustes propios de la ejecución de una tarea (ver TASK_DENIED_COMMANDS)
  taskSettings: string;
  // Copias de solo lectura de los adjuntos de la bóveda (solo con MCP)
  attachments: string;
}

export const workFilesOf = (workDir: string, key: string): WorkFiles => ({
  mcp: path.join(workDir, CHAT_FILES.mcp),
  context: path.join(workDir, CHAT_FILES.context),
  taskSettings: path.join(workDir, CHAT_FILES.taskSettings),
  attachments: isAnalysisKey(key)
    ? path.join(workDir, WORK_ATTACHMENTS_DIR, WORK_ANALYSIS_DIR, key)
    : path.join(workDir, WORK_ATTACHMENTS_DIR, key),
});

// Van antes del resto: --mcp-config, --add-dir y --allowedTools son variádicas y se tragarían el prompt final;
// el --append-system-prompt-file de cierre las corta
export const handoffKnowledgeArgs = (kb: ChatKnowledge | null, files: WorkFiles): string[] => {
  const context = ['--append-system-prompt-file', files.context];
  if (kb?.type === 'mcp')
    return [ADD_DIR_FLAG, files.attachments, '--mcp-config', files.mcp, '--allowedTools', KB_MCP_RULES, ...context];
  return kb?.type === 'local' ? [ADD_DIR_FLAG, kb.root, ...context] : [];
};

// Los commits y los push los hace siempre el dev: al ejecutar una tarea Claude no puede hacerlos.
// Una regla deny gana sobre cualquier allow de los ajustes del dev o del proyecto. Es una barrera de buena fe
// (las reglas de Bash casan por texto); la segunda forma cubre opciones previas como `git -C <repo> commit`.
export const TASK_DENIED_COMMANDS: readonly string[] = [
  'Bash(git commit:*)',
  'Bash(git push:*)',
  'Bash(git * commit:*)',
  'Bash(git * push:*)',
];

// extraDeny: reglas propias de la sesión (p. ej. el estado de jm de un análisis)
export const buildTaskSettings = (extraDeny: readonly string[] = []): Record<string, unknown> => ({
  permissions: { deny: [...TASK_DENIED_COMMANDS, ...extraDeny] },
});

// Se regenera en cada arranque: contenido fijo de jm, no depende de lo que haya en disco
export const writeTaskSettings = (workDir: string, extraDeny: readonly string[] = []): string =>
  writeWorkFile(workDir, CHAT_FILES.taskSettings, `${JSON.stringify(buildTaskSettings(extraDeny), null, 2)}\n`);

// Al ejecutar una tarea el contexto de la tarea viaja siempre, haya o no base conectada.
// --settings va primero: las banderas variádicas de la base se tragarían lo que siga.
export const taskHandoffArgs = (kb: ChatKnowledge | null, files: WorkFiles): string[] => {
  const args = handoffKnowledgeArgs(kb, files);
  return [
    '--settings',
    files.taskSettings,
    ...(args.length > 0 ? args : ['--append-system-prompt-file', files.context]),
  ];
};

export interface LaunchOptions {
  key: string;
  existingSessionId: string | null;
  cwd: string;
  run: ClaudeRunner;
  saveSessionId: (sessionId: string) => Promise<void>;
  newSessionId?: () => string;
  extraArgs?: string[];
  command?: ClaudeCommand;
  // Subtarea que se ejecuta; solo con command 'ejecutar' ('key' es entonces la historia)
  issueKey?: string;
}

export async function launchClaude(options: LaunchOptions): Promise<void> {
  const {
    key,
    existingSessionId,
    cwd,
    run,
    saveSessionId,
    newSessionId = randomUUID,
    extraArgs = [],
    command = 'refinar',
    issueKey,
  } = options;
  if (existingSessionId) {
    const result = await run([...extraArgs, ...buildResumeArgs(existingSessionId)], cwd);
    const resumed = result.code === 0 || result.elapsedMs >= RESUME_FAIL_WINDOW_MS;
    if (resumed) return;
  }
  const sessionId = newSessionId();
  await saveSessionId(sessionId);
  await run([...extraArgs, ...buildNewSessionArgs(key, sessionId, command, issueKey)], cwd);
}
