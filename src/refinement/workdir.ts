import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lexists, safeEnsureDirIn, safeWriteFileIn } from './safe-fs';

const WORK_HASH_LENGTH = 16;
const READ_ONLY_MODE = 0o400;
const PRIVATE_DIR_MODE = 0o700;
const WORK_SEGMENTS = ['.jira-tool', 'trabajo'];
export const WORK_ATTACHMENTS_DIR = 'adjuntos';
// Copias de las fuentes de un análisis: <adjuntos>/analisis/<id>, aparte de las de historias (NTFS no distingue an-1 de AN-1)
export const WORK_ANALYSIS_DIR = 'analisis';
export const WORK_OPEN_DIR = 'abrir';

// Archivos técnicos que Claude lee al arrancar; viven en la carpeta de trabajo de jm, nunca en el repositorio
export const CHAT_FILES = {
  settings: 'claude-settings.json',
  taskSettings: 'tarea-settings.json',
  agents: 'agents.json',
  skill: 'refinar-skill.md',
  analysisSkill: 'analizar-skill.md',
  mcp: 'mcp.json',
  context: 'knowledge-context.md',
} as const;
export const DASHBOARD_WORK_FILE = 'dashboard.md';

export const workBase = (home: string = os.homedir()): string => path.join(home, ...WORK_SEGMENTS);

function realOrResolved(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

// Una carpeta de trabajo por proyecto: el hash de su ruta real evita mezclar proyectos
export function workDirFor(root: string, home?: string): string {
  const hash = createHash('sha256').update(realOrResolved(root)).digest('hex').slice(0, WORK_HASH_LENGTH);
  return path.join(workBase(home), hash);
}

export const isWorkHashSegment = (segment: string): boolean =>
  new RegExp(`^[0-9a-f]{${WORK_HASH_LENGTH}}$`).test(segment);

// Solo el usuario entra a ~/.jira-tool/trabajo: ahí viven la configuración de Claude y copias de adjuntos
function ensureWorkDir(workDir: string): void {
  fs.mkdirSync(path.dirname(workDir), { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.mkdirSync(workDir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

export function writeWorkFile(workDir: string, name: string, content: string): string {
  const file = path.join(workDir, name);
  ensureWorkDir(workDir);
  safeEnsureDirIn(workDir, workDir);
  safeWriteFileIn(workDir, file, content);
  return file;
}

export function removeWorkFile(workDir: string, name: string): void {
  const file = path.join(workDir, name);
  if (lexists(file)) fs.rmSync(file);
}

// Copia de solo lectura de un adjunto de la bóveda para que Claude pueda abrirlo (imagen/PDF); los nombres llevan el id de Jira
export function writeReadOnlyCopy(workDir: string, folder: string, name: string, data: Buffer): string {
  const dir = path.join(workDir, folder);
  const file = path.join(dir, name);
  ensureWorkDir(workDir);
  safeEnsureDirIn(workDir, dir);
  if (lexists(file)) {
    if (!fs.lstatSync(file).isFile()) throw new Error(`Por seguridad no reutilizo ${file}: no es un archivo normal.`);
    if (sha256(fs.readFileSync(file)) === sha256(data)) return file;
  }
  fs.rmSync(file, { force: true });
  safeWriteFileIn(workDir, file, data);
  fs.chmodSync(file, READ_ONLY_MODE);
  return file;
}
