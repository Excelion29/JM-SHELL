import type { StoryState } from './types';

export type StoreKind = 'project' | 'local' | 'vault';

export interface StoreEntry {
  name: string;
  isFile: boolean;
  // Bytes, cuando el almacén los da sin leer el contenido (el local); la bóveda no
  size?: number;
}

// Dónde vive una historia: la carpeta .jm del proyecto, una carpeta local de la base o la bóveda por REST.
// Los nombres son relativos a la carpeta de la historia y se validan igual en los tres.
export interface StoryStore {
  readonly kind: StoreKind;
  // Texto para mensajes al dev (ruta o ubicación en la bóveda)
  readonly label: string;
  // Se ejecuta tras cada cambio de fase, resumen o tareas creadas (mantiene el índice de la base)
  onStoryChanged?: (state: StoryState) => Promise<void>;
  // Prepara la ubicación antes de escribir por primera vez
  ensureReady: () => Promise<void>;
  // null si no existe
  readText: (name: string) => Promise<string | null>;
  writeText: (name: string, content: string) => Promise<void>;
  append: (name: string, text: string) => Promise<void>;
  // null si no existe; lanza si pasa de maxBytes
  readBinary: (name: string, maxBytes: number) => Promise<Buffer | null>;
  writeBinary: (name: string, data: Buffer) => Promise<void>;
  // Vacío si la carpeta no existe
  list: (dir: string) => Promise<StoreEntry[]>;
  exists: (name: string) => Promise<boolean>;
  remove: (name: string) => Promise<void>;
  // Ruta absoluta en disco si el contenido es un archivo local; null en la bóveda
  localPath: (name: string) => string | null;
}

const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\\:*?"<>|%]/;
const UNICODE_NORMAL_FORM = 'NFKC';

// Mismas reglas que checkKbPath (kb-proxy): sin "..", sin "\", sin segmentos que empiecen por "."
export function assertStoryName(name: string, allowEmpty = false): void {
  if (name === '' && allowEmpty) return;
  const invalid =
    name === '' ||
    name.startsWith('/') ||
    name.includes('..') ||
    UNSAFE_NAME_CHARS.test(name) ||
    name.normalize(UNICODE_NORMAL_FORM) !== name ||
    name.split('/').some((segment) => segment === '' || segment.startsWith('.'));
  if (invalid) throw new Error(`Nombre de archivo no permitido en la historia: "${name}".`);
}

export async function readJson(store: StoryStore, name: string): Promise<unknown | null> {
  const text = await store.readText(name);
  return text === null ? null : (JSON.parse(text) as unknown);
}

export const writeJson = (store: StoryStore, name: string, value: unknown): Promise<void> =>
  store.writeText(name, `${JSON.stringify(value, null, 2)}\n`);
