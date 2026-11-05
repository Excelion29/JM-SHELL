import * as fs from 'fs-extra';
import * as path from 'path';
import { isValidBaseFolder } from './knowledge';
import { createRestClient, RestEntry, RestOptions } from './knowledge-rest';

export type KnowledgeEntry = RestEntry;

// Misma interfaz para el MCP (API REST de Obsidian) y para una carpeta local
export interface KnowledgeSource {
  listChildren: (dir: string) => Promise<KnowledgeEntry[]>;
  // null si la nota no existe; con maxBytes solo se lee ese principio
  readNote: (file: string, maxBytes?: number) => Promise<string | null>;
  close: () => void;
}

const PREVIEW_LINES = 15;
const PREVIEW_MAX_CHARS = 1200;
export const PREVIEW_MAX_BYTES = 8 * 1024;
const NOT_FOUND = 'ENOENT';

export const previewOf = (content: string): string =>
  content.split(/\r?\n/).slice(0, PREVIEW_LINES).join('\n').slice(0, PREVIEW_MAX_CHARS);

export const createRestSource = (options: RestOptions): KnowledgeSource => {
  const client = createRestClient(options);
  return { listChildren: client.listDir, readNote: client.readFile, close: client.close };
};

function resolveLocal(root: string, relative: string): string {
  if (!isValidBaseFolder(relative.replace(/\.md$/, '')))
    throw new Error(`Ruta no permitida en la base: "${relative}".`);
  return path.join(root, ...relative.split('/'));
}

// Un enlace simbólico o una unión (junction) dentro de la base podría apuntar fuera de la raíz
async function assertInsideRoot(root: string, target: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  const relative = path.relative(realRoot, realTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('La ruta sale de la carpeta de la base de conocimiento.');
}

async function readHead(file: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await fs.read(handle, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fs.close(handle);
  }
}

export const createLocalSource = (root: string): KnowledgeSource => ({
  async listChildren(dir) {
    const target = resolveLocal(root, dir);
    await assertInsideRoot(root, target);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isFolder: entry.isDirectory() }));
  },
  async readNote(file, maxBytes) {
    const target = resolveLocal(root, file);
    try {
      await assertInsideRoot(root, target);
      return maxBytes === undefined ? await fs.readFile(target, 'utf8') : await readHead(target, maxBytes);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === NOT_FOUND) return null;
      throw err;
    }
  },
  close: () => undefined,
});

export const sortEntries = (entries: KnowledgeEntry[]): KnowledgeEntry[] =>
  [...entries].sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
