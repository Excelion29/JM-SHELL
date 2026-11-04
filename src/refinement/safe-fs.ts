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

// En Windows lstat también reporta las junctions como enlaces simbólicos
export function assertNoLinks(root: string, target: string): void {
  const jmDir = path.resolve(root, JM_DIR);
  const resolved = path.resolve(target);
  if (!isInside(jmDir, resolved)) refuse(resolved, `queda fuera de ${jmDir}`);

  let current = jmDir;
  let deepestExisting: string | null = null;
  const parts = path.relative(jmDir, resolved).split(path.sep).filter(Boolean);
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) refuse(resolved, `${current} es un enlace simbólico o junction`);
    deepestExisting = current;
  }
  if (deepestExisting && !isInside(fs.realpathSync(jmDir), fs.realpathSync(deepestExisting))) {
    refuse(resolved, 'su ruta real sale de la carpeta .jm');
  }
}

export function lexists(target: string): boolean {
  return lstatOrNull(target) !== null;
}

export function safeEnsureDir(root: string, dir: string): void {
  assertNoLinks(root, dir);
  fs.mkdirSync(dir, { recursive: true });
  assertNoLinks(root, dir);
}

// Temp exclusivo + rename: nunca escribe a través de un enlace que ocupe el destino
export function safeWriteFile(root: string, file: string, content: string): void {
  assertNoLinks(root, file);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (err: unknown) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}
