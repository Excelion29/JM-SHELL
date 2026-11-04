import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const CLAUDE_BIN = 'claude';
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const SHELL_SHIM_EXTENSIONS = ['.cmd', '.bat'];
// Un --resume con sesión inexistente termina casi al instante con código != 0
const RESUME_FAIL_WINDOW_MS = 5000;

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const KEY_SOURCE = '[A-Z][A-Z0-9]+-\\d+';
const ALLOWED_ARGS: RegExp[] = [
  /^(--session-id|--resume|-n)$/,
  SESSION_ID_PATTERN,
  new RegExp(`^refinar ${KEY_SOURCE}$`),
  new RegExp(`^/refinar ${KEY_SOURCE}$`),
];

export interface ClaudeRunResult {
  code: number | null;
  elapsedMs: number;
}

export type ClaudeRunner = (args: string[], cwd: string) => Promise<ClaudeRunResult>;

// Última barrera antes de spawn: ningún texto fuera de esta lista llega a un proceso
export function assertSafeArgs(args: string[]): void {
  for (const arg of args) {
    if (!ALLOWED_ARGS.some((pattern) => pattern.test(arg))) {
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

export const runClaude: ClaudeRunner = (args, cwd) => {
  assertSafeArgs(args);
  const executable = resolveClaude();
  if (!executable) return Promise.reject(new Error('No encontré `claude` en el PATH.'));
  const { file, needsShell } = executable;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = needsShell
      ? spawn(quoteArg(file), args.map(quoteArg), { cwd, stdio: 'inherit', shell: true, env: SHELL_ENV })
      : spawn(file, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, elapsedMs: Date.now() - started }));
  });
};

export const buildNewSessionArgs = (key: string, sessionId: string): string[] => [
  '--session-id',
  sessionId,
  '-n',
  `refinar ${key}`,
  `/refinar ${key}`,
];

export const buildResumeArgs = (sessionId: string): string[] => ['--resume', sessionId];

export interface LaunchOptions {
  key: string;
  existingSessionId: string | null;
  cwd: string;
  run: ClaudeRunner;
  saveSessionId: (sessionId: string) => Promise<void>;
  newSessionId?: () => string;
}

export async function launchClaude(options: LaunchOptions): Promise<void> {
  const { key, existingSessionId, cwd, run, saveSessionId, newSessionId = randomUUID } = options;
  if (existingSessionId) {
    const result = await run(buildResumeArgs(existingSessionId), cwd);
    const resumed = result.code === 0 || result.elapsedMs >= RESUME_FAIL_WINDOW_MS;
    if (resumed) return;
  }
  const sessionId = newSessionId();
  await saveSessionId(sessionId);
  await run(buildNewSessionArgs(key, sessionId), cwd);
}
