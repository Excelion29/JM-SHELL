import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const JM_DIR = '.jm';

function refuse(target: string, reason: string): never {
  throw new Error(`Por seguridad no escribo en ${target}: ${reason}.`);
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// `anchor` es la carpeta protegida: nada por debajo de ella puede ser un enlace ni salir de ella
// En Windows lstat también reporta las junctions como enlaces simbólicos
export function assertNoLinksIn(anchor: string, target: string): void {
  const anchorDir = path.resolve(anchor);
  const resolved = path.resolve(target);
  if (!isInside(anchorDir, resolved)) refuse(resolved, `queda fuera de ${anchorDir}`);

  let current = anchorDir;
  let deepestExisting: string | null = null;
  const parts = path.relative(anchorDir, resolved).split(path.sep).filter(Boolean);
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) refuse(resolved, `${current} es un enlace simbólico o junction`);
    deepestExisting = current;
  }
  if (deepestExisting && !isInside(fs.realpathSync(anchorDir), fs.realpathSync(deepestExisting))) {
    refuse(resolved, `su ruta real sale de la carpeta ${anchorDir}`);
  }
}

export const assertNoLinks = (root: string, target: string): void =>
  assertNoLinksIn(path.resolve(root, JM_DIR), target);

export function lexists(target: string): boolean {
  return lstatOrNull(target) !== null;
}

export function safeEnsureDirIn(anchor: string, dir: string): void {
  assertNoLinksIn(anchor, dir);
  fs.mkdirSync(dir, { recursive: true });
  assertNoLinksIn(anchor, dir);
}

export const safeEnsureDir = (root: string, dir: string): void => safeEnsureDirIn(path.resolve(root, JM_DIR), dir);

// Temp exclusivo + rename: nunca escribe a través de un enlace que ocupe el destino
export function safeWriteFileIn(anchor: string, file: string, content: string | Buffer): void {
  assertNoLinksIn(anchor, file);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    if (typeof content === 'string') fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    else fs.writeFileSync(temp, content, { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (err: unknown) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

export const safeWriteFile = (root: string, file: string, content: string): void =>
  safeWriteFileIn(path.resolve(root, JM_DIR), file, content);
