// Fuentes de un análisis: se copian a fuentes/ del almacén; las rutas vienen escritas por el dev
import * as fs from 'fs';
import * as path from 'path';
import { MAX_ATTACHMENT_BYTES, sanitizeFilename } from './attachments';
import { readAnalysis, updateAnalysis } from './analysis';
import type { AnalysisSource, SourceResult, SourcesInput } from './analysis-types';
import type { StoryStore } from './story-store';

export const SOURCES_DIR = 'fuentes';
export const TEXT_SOURCE_FILE = 'texto.md';
export const SOURCE_EXTENSIONS = ['.md', '.txt', '.pdf', '.eml', '.png', '.jpg', '.jpeg'] as const;
const PATH_SEPARATORS = new Set([',', ';', '\n', '\r']);
const QUOTES = new Set(['"', "'"]);
const TEXT_SEPARATOR = '\n\n---\n\n';
const BYTES_PER_MB = 1024 * 1024;
const MAX_MB = MAX_ATTACHMENT_BYTES / BYTES_PER_MB;
const TOO_BIG = `pesa más de ${MAX_MB} MB.`;

export const NOTHING_TO_ADD = 'Escribe una ruta de archivo o pega texto.';

// Coma, punto y coma o salto de línea separan; lo que va entre comillas se conserva tal cual (rutas con espacios o comas)
export function parsePathList(raw: string): string[] {
  const paths: string[] = [];
  let current = '';
  let quote: string | null = null;
  const flush = () => {
    if (current.trim()) paths.push(current.trim());
    current = '';
  };
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (QUOTES.has(char)) quote = char;
    else if (PATH_SEPARATORS.has(char)) flush();
    else current += char;
  }
  flush();
  return paths;
}

const failed = (source: string, message: string): SourceResult => ({ source, ok: false, message });

// <nombre>, <nombre>-2, <nombre>-3...: nunca pisa una fuente existente ni el texto pegado.
// `taken` guarda minúsculas: en Windows a.md y A.MD son el mismo archivo
function uniqueName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted.toLowerCase())) return wanted;
  const { name, ext } = path.parse(wanted);
  for (let n = 2; ; n += 1) {
    const candidate = `${name}-${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// El tope se aplica a lo que de verdad se lee del descriptor: el archivo pudo crecer tras el lstat
async function readCapped(source: string): Promise<{ data: Buffer } | { message: string }> {
  const handle = await fs.promises.open(source, 'r');
  try {
    if (!(await handle.stat()).isFile()) return { message: 'no es un archivo.' };
    const buffer = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total > MAX_ATTACHMENT_BYTES ? { message: TOO_BIG } : { data: buffer.subarray(0, total) };
  } finally {
    await handle.close();
  }
}

async function readSourceFile(source: string): Promise<{ data: Buffer } | { message: string }> {
  if (!path.isAbsolute(source)) return { message: 'la ruta debe ser absoluta.' };
  const extension = path.extname(source).toLowerCase();
  if (!(SOURCE_EXTENSIONS as readonly string[]).includes(extension)) {
    return { message: `tipo no admitido (${extension || 'sin extensión'}); usa ${SOURCE_EXTENSIONS.join(' ')}.` };
  }
  const link = await fs.promises.lstat(source).catch(() => null);
  if (!link) return { message: 'no encontré el archivo.' };
  if (link.isSymbolicLink()) return { message: 'es un enlace simbólico: no lo sigo.' };
  if (!link.isFile()) return { message: 'no es un archivo.' };
  if (link.size > MAX_ATTACHMENT_BYTES) return { message: TOO_BIG };
  try {
    return await readCapped(source);
  } catch (err: unknown) {
    return { message: `no pude leerlo (${(err as Error).message}).` };
  }
}

async function ingestFile(
  store: StoryStore,
  source: string,
  taken: Set<string>,
): Promise<{ result: SourceResult; added?: string }> {
  const read = await readSourceFile(source);
  if ('message' in read) return { result: failed(source, read.message) };
  const file = uniqueName(sanitizeFilename(source), taken);
  try {
    await store.writeBinary(`${SOURCES_DIR}/${file}`, read.data);
  } catch (err: unknown) {
    return { result: failed(source, `no pude guardarlo (${(err as Error).message}).`) };
  }
  taken.add(file.toLowerCase());
  return { result: { source, ok: true, file }, added: file };
}

// Copia los archivos válidos y el texto; cada archivo con problema se informa y no frena a los demás
export async function addSources(store: StoryStore, id: string, input: SourcesInput): Promise<SourceResult[]> {
  const sources = parsePathList(input.paths);
  const text = input.text.trim();
  if (sources.length === 0 && !text) throw new Error(NOTHING_TO_ADD);
  const state = await readAnalysis(store, id);
  if (!state) throw new Error(`El análisis ${id} no existe.`);
  const taken = new Set([...state.sources.map((s) => s.file), TEXT_SOURCE_FILE].map((f) => f.toLowerCase()));
  const results: SourceResult[] = [];
  const added: AnalysisSource[] = [];
  const addedAt = new Date().toISOString();
  for (const source of sources) {
    const outcome = await ingestFile(store, source, taken);
    results.push(outcome.result);
    if (outcome.added) added.push({ file: outcome.added, origin: 'file', addedAt });
  }
  if (text) {
    const name = `${SOURCES_DIR}/${TEXT_SOURCE_FILE}`;
    const previous = await store.readText(name);
    const next = previous ? `${previous.trimEnd()}${TEXT_SEPARATOR}${text}\n` : `${text}\n`;
    if (Buffer.byteLength(next) > MAX_ATTACHMENT_BYTES) results.push(failed(TEXT_SOURCE_FILE, `con ese texto ${TOO_BIG}`));
    else {
      await store.writeText(name, next);
      if (!state.sources.some((s) => s.file === TEXT_SOURCE_FILE)) {
        added.push({ file: TEXT_SOURCE_FILE, origin: 'text', addedAt });
      }
      results.push({ source: TEXT_SOURCE_FILE, ok: true, file: TEXT_SOURCE_FILE });
    }
  }
  if (added.length > 0) await updateAnalysis(store, id, (s) => void s.sources.push(...added));
  return results;
}
