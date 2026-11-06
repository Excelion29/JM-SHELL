import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_ATTACHMENT_BYTES } from './attachments';
import { ensureGitExclude } from './git-exclude';
import { assertNoLinks, JM_DIR, lexists } from './safe-fs';
import { CHAT_FILE, LEGACY_CHAT_FILE, STATE_FILE, STORIES_DIR } from './state';
import { assertStoryName, StoryStore } from './story-store';

const TEXT_EXTENSIONS = new Set(['.md', '.json', '.jsonl']);
const BACKUP_INFIX = 'respaldo';
// Archivos técnicos de versiones anteriores: ahora viven en la carpeta de trabajo, fuera del repositorio
const LEGACY_TECHNICAL_FILES = [
  'agents.json',
  'claude-settings.json',
  'mcp.json',
  'knowledge-context.md',
  'refinar-skill.md',
  'INICIO.md',
];
// O_NOFOLLOW no existe en Windows; allí quedan el walk sin enlaces y la comprobación del descriptor
const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
const SINGLE_LINK = 1;
const FIRST_SUFFIX = 2;
const GITIGNORE_FILE = '.gitignore';
const NOT_EMPTY = 'ENOTEMPTY';
const PAD = 2;

export interface MigrationResult {
  moved: boolean;
  // Aviso para el dev (conflicto con respaldo, archivos que no se pudieron mover)
  notice?: string;
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const pad = (n: number) => String(n).padStart(PAD, '0');

export const backupStamp = (now: Date): string =>
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

export const legacyStoryDir = (root: string, key: string): string => path.join(root, JM_DIR, STORIES_DIR, key);

// Un .chat.jsonl con punto inicial no entra al proxy ni a Obsidian: se renombra en el mismo lugar
export function renameLegacyChat(dir: string): void {
  const legacy = path.join(dir, LEGACY_CHAT_FILE);
  const current = path.join(dir, CHAT_FILE);
  if (fs.existsSync(legacy) && !fs.existsSync(current)) fs.renameSync(legacy, current);
}

interface LocalFile {
  relative: string;
  absolute: string;
}

function walk(dir: string, prefix = ''): LocalFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Por seguridad no sigo enlaces ni junctions: ${absolute}.`);
    if (entry.isDirectory()) return walk(absolute, relative);
    return entry.isFile() ? [{ relative, absolute }] : [];
  });
}

const targetName = (relative: string): string => (relative === LEGACY_CHAT_FILE ? CHAT_FILE : relative);

// Abre sin seguir enlaces y valida el descriptor: archivo regular, un solo vínculo y dentro del tope
function readRegularFile(file: string): Buffer | null {
  let fd: number;
  try {
    fd = fs.openSync(file, READ_FLAGS);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== SINGLE_LINK || stat.size > MAX_ATTACHMENT_BYTES) return null;
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readOrThrow(file: LocalFile): Buffer {
  const data = readRegularFile(file.absolute);
  if (!data) throw new Error(`No pude leer ${file.relative} de forma segura.`);
  return data;
}

function isMovable(file: LocalFile): boolean {
  try {
    assertStoryName(targetName(file.relative));
  } catch {
    return false;
  }
  return readRegularFile(file.absolute) !== null;
}

async function sameInStore(store: StoryStore, name: string, data: Buffer): Promise<boolean> {
  const existing = await store.readBinary(name, MAX_ATTACHMENT_BYTES);
  return existing !== null && sha256(existing) === sha256(data);
}

async function copyVerified(store: StoryStore, file: LocalFile): Promise<void> {
  const name = targetName(file.relative);
  const data = readOrThrow(file);
  if (await sameInStore(store, name, data)) return;
  if (TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) await store.writeText(name, data.toString('utf8'));
  else await store.writeBinary(name, data);
  if (!(await sameInStore(store, name, data))) throw new Error(`La copia de ${name} no coincide con el original.`);
}

// estado.json va al final: su presencia en la base es lo que marca la migración como terminada
const stateLast = (files: LocalFile[]): LocalFile[] => [
  ...files.filter((f) => f.relative !== STATE_FILE),
  ...files.filter((f) => f.relative === STATE_FILE),
];

async function allCopied(store: StoryStore, files: LocalFile[]): Promise<boolean> {
  for (const file of files) {
    if (!(await sameInStore(store, targetName(file.relative), readOrThrow(file)))) return false;
  }
  return true;
}

function removeIfEmpty(dir: string): void {
  try {
    fs.rmdirSync(dir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== NOT_EMPTY && code !== 'ENOENT') throw err;
  }
}

// .jm queda solo si aún guarda historias sin mover
function cleanJmDir(root: string): void {
  const jmDir = path.join(root, JM_DIR);
  if (!fs.existsSync(jmDir)) return;
  assertNoLinks(root, jmDir);
  const remove = (file: string): void => {
    assertNoLinks(root, file);
    fs.rmSync(file, { force: true });
  };
  for (const name of LEGACY_TECHNICAL_FILES) remove(path.join(jmDir, name));
  const storiesDir = path.join(jmDir, STORIES_DIR);
  assertNoLinks(root, storiesDir);
  removeIfEmpty(storiesDir);
  if (!fs.existsSync(storiesDir)) remove(path.join(jmDir, GITIGNORE_FILE));
  removeIfEmpty(jmDir);
}

function removeStoryDir(root: string, dir: string): void {
  assertNoLinks(root, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  cleanJmDir(root);
}

// Un respaldo previo del mismo minuto no se pisa: se numera -2, -3...
function freeBackupName(root: string, dir: string, base: string): string {
  let name = base;
  for (let n = FIRST_SUFFIX; ; n++) {
    const candidate = path.join(path.dirname(dir), name);
    assertNoLinks(root, candidate);
    if (!lexists(candidate)) return name;
    name = `${base}-${n}`;
  }
}

function backUp(root: string, key: string, dir: string, now: Date): string {
  assertNoLinks(root, dir);
  const backup = freeBackupName(root, dir, `${key}.${BACKUP_INFIX}-${backupStamp(now)}`);
  fs.renameSync(dir, path.join(path.dirname(dir), backup));
  ensureGitExclude(root);
  return backup;
}

const unmovableNotice = (key: string, count: number): string =>
  `Copié ${key} a la base, pero ${count} archivo(s) de .jm no se pueden mover y quedaron donde estaban.`;

// Mueve .jm/historias/<KEY> a la base la primera vez; la base manda si ya tiene la historia
export async function migrateLocalStory(
  root: string,
  key: string,
  target: StoryStore,
  now: Date = new Date(),
): Promise<MigrationResult> {
  const dir = legacyStoryDir(root, key);
  assertNoLinks(root, dir);
  if (!fs.existsSync(dir)) return { moved: false };
  const files = walk(dir);
  const movable = files.filter(isMovable);
  const skipped = files.length - movable.length;

  if (await target.exists(STATE_FILE)) {
    if (await allCopied(target, movable)) {
      if (skipped > 0) return { moved: true, notice: unmovableNotice(key, skipped) };
      removeStoryDir(root, dir);
      return { moved: true };
    }
    const backup = backUp(root, key, dir, now);
    return {
      moved: false,
      notice: `${key} ya estaba en la base y tenía otra copia en .jm: usé la de la base. Guardé la local como ${JM_DIR}/${STORIES_DIR}/${backup}.`,
    };
  }

  for (const file of stateLast(movable)) await copyVerified(target, file);
  if (skipped > 0) {
    return { moved: true, notice: unmovableNotice(key, skipped) };
  }
  removeStoryDir(root, dir);
  return { moved: true };
}
