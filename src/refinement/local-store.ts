import * as fs from 'fs';
import * as path from 'path';
import { assertNoLinksIn, lexists, safeEnsureDirIn, safeWriteFileIn } from './safe-fs';
import { assertStoryName, StoreEntry, StoreKind, StoryStore } from './story-store';

// O_NOFOLLOW no existe en Windows; allí quedan assertNoLinksIn y la comprobación del descriptor
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
const NOT_FOUND = 'ENOENT';
const BYTES_PER_MB = 1024 * 1024;
const MAX_TEXT_BYTES = 50 * BYTES_PER_MB;
const APPEND_FLAGS =
  fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);

// Abre sin seguir enlaces y valida el descriptor: entre comprobar y leer nadie puede cambiar el archivo
function withRegularFile<T>(
  file: string,
  name: string,
  flags: number,
  maxBytes: number,
  use: (fd: number, size: number) => T,
): T {
  const fd = fs.openSync(file, flags);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${name} no es un archivo regular.`);
    if (stat.size > maxBytes) throw new Error(`${name} pesa más de ${Math.round(maxBytes / BYTES_PER_MB)} MB.`);
    return use(fd, stat.size);
  } finally {
    fs.closeSync(fd);
  }
}

export interface LocalStoreOptions {
  kind: Extract<StoreKind, 'project' | 'local'>;
  // Carpeta protegida: nada por debajo puede ser un enlace ni salir de ella
  anchor: string;
  // Carpeta de la historia (dentro de anchor)
  dir: string;
  // Paso extra al preparar la carpeta (p. ej. ignorar .jm en git)
  prepare?: () => void;
}

export function createLocalStore({ kind, anchor, dir, prepare }: LocalStoreOptions): StoryStore {
  const target = (name: string, allowEmpty = false): string => {
    assertStoryName(name, allowEmpty);
    const file = name === '' ? dir : path.join(dir, ...name.split('/'));
    assertNoLinksIn(anchor, file);
    return file;
  };
  const ensureParent = (file: string) => safeEnsureDirIn(anchor, path.dirname(file));

  return {
    kind,
    label: dir,
    async ensureReady() {
      safeEnsureDirIn(anchor, dir);
      prepare?.();
    },
    async readText(name) {
      const file = target(name);
      if (!lexists(file)) return null;
      return withRegularFile(file, name, OPEN_FLAGS, MAX_TEXT_BYTES, (fd) => fs.readFileSync(fd, 'utf8'));
    },
    async writeText(name, content) {
      const file = target(name);
      ensureParent(file);
      safeWriteFileIn(anchor, file, content);
    },
    async append(name, text) {
      const file = target(name);
      ensureParent(file);
      withRegularFile(file, name, APPEND_FLAGS, MAX_TEXT_BYTES, (fd) => fs.writeSync(fd, text, null, 'utf8'));
    },
    async readBinary(name, maxBytes) {
      const file = target(name);
      if (!lexists(file)) return null;
      return withRegularFile(file, name, OPEN_FLAGS, maxBytes, (fd) => fs.readFileSync(fd));
    },
    async writeBinary(name, data) {
      const file = target(name);
      ensureParent(file);
      safeWriteFileIn(anchor, file, data);
    },
    async list(listDir) {
      const folder = target(listDir, true);
      if (!lexists(folder)) return [];
      return fs.readdirSync(folder, { withFileTypes: true }).map((entry): StoreEntry => {
        const isFile = entry.isFile();
        return isFile
          ? { name: entry.name, isFile, size: fs.lstatSync(path.join(folder, entry.name)).size }
          : { name: entry.name, isFile };
      });
    },
    async exists(name) {
      return lexists(target(name));
    },
    async remove(name) {
      const file = target(name);
      try {
        fs.rmSync(file);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== NOT_FOUND) throw err;
      }
    },
    async removeFolder(folderName) {
      const folder = target(folderName, true);
      try {
        fs.rmdirSync(folder);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== NOT_FOUND) throw err;
      }
    },
    localPath: (name) => target(name),
  };
}
