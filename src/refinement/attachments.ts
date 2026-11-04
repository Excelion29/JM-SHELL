import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const FALLBACK_NAME = 'file';
const UNSAFE_CHARS = /[^\w.\- ]/g;
const TRAILING_DOTS_SPACES = /[. ]+$/;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(UNSAFE_CHARS, '_').replace(TRAILING_DOTS_SPACES, '');
  if (!cleaned) return FALLBACK_NAME;
  const stem = cleaned.split('.')[0].trim();
  return WINDOWS_RESERVED.test(stem) ? `_${cleaned}` : cleaned;
}

// El prefijo con el id evita colisiones entre adjuntos con el mismo nombre
export function attachmentFileName(id: string, filename: string): string {
  return `${id.replace(UNSAFE_CHARS, '_')}-${sanitizeFilename(filename)}`;
}

export function resolveInside(dir: string, name: string): string {
  const root = path.resolve(dir);
  const dest = path.resolve(root, name);
  if (path.dirname(dest) !== root) throw new Error(`El adjunto "${name}" cae fuera de ${root}.`);
  return dest;
}

// Las credenciales solo viajan al mismo origen que la URL de Jira configurada
export function assertSameOrigin(url: string, baseUrl: string): void {
  if (new URL(url).origin !== new URL(baseUrl).origin) {
    throw new Error(`La URL del adjunto no pertenece a ${new URL(baseUrl).origin}; no la descargo.`);
  }
}

export class AttachmentTooLargeError extends Error {}

export async function streamToFileWithCap(source: Readable, dest: string, maxBytes: number): Promise<void> {
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new AttachmentTooLargeError(`Supera el tope de ${maxBytes} bytes.`));
      else callback(null, chunk);
    },
  });
  // Temp exclusivo ('wx') + rename: nunca escribe a través de un enlace que ocupe el destino
  const temp = `${dest}.${randomUUID()}.part`;
  try {
    await pipeline(source, counter, fs.createWriteStream(temp, { flags: 'wx' }));
    await fs.promises.rename(temp, dest);
  } catch (err: unknown) {
    await fs.promises.rm(temp, { force: true });
    throw err;
  }
}
