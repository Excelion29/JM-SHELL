import * as fs from 'fs';
import { randomUUID } from 'crypto';

// Para archivos fuera de .jm (p. ej. .jira.json): nunca escribe a través de un enlace
export function writeFileAtomicNoLinks(file: string, content: string): void {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(file);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (stat?.isSymbolicLink()) throw new Error(`Por seguridad no escribo en ${file}: es un enlace simbólico.`);

  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (err: unknown) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}
