import * as path from 'path';
import { checkKbPath } from './kb-proxy';
import { joinKnowledgePath } from './knowledge';
import { RestClient, RestStatusError } from './knowledge-rest';
import { assertStoryName, StoryStore } from './story-store';

const HTTP_NOT_FOUND = 404;

export interface VaultStoreOptions {
  client: Pick<RestClient, 'listDir' | 'readFile' | 'readBuffer' | 'writeFile' | 'appendFile' | 'deleteFile'>;
  // Carpeta base configurada: toda ruta debe quedar dentro
  baseFolder: string;
  // Carpeta de la historia dentro de la bóveda, p. ej. PROYECTOS/X/06-JM-ADR/AQ-45
  dir: string;
  label: string;
}

export function createVaultStore({ client, baseFolder, dir, label }: VaultStoreOptions): StoryStore {
  const target = (name: string, allowEmpty = false): string => {
    assertStoryName(name, allowEmpty);
    const full = joinKnowledgePath(dir, name);
    if (full !== dir && !full.startsWith(`${dir}/`)) throw new Error(`Ruta fuera de la historia en la base: ${full}.`);
    const problem = checkKbPath(full, baseFolder, true);
    if (problem) throw new Error(`Ruta no permitida en la base (${full}): ${problem}.`);
    return full;
  };

  const list: StoryStore['list'] = async (listDir) => {
    try {
      const entries = await client.listDir(target(listDir, true));
      return entries.map(({ name, isFolder }) => ({ name, isFile: !isFolder }));
    } catch (err: unknown) {
      if (err instanceof RestStatusError && err.status === HTTP_NOT_FOUND) return [];
      throw err;
    }
  };

  return {
    kind: 'vault',
    label,
    // La bóveda crea las carpetas al escribir
    ensureReady: async () => undefined,
    async readText(name) {
      return client.readFile(target(name));
    },
    async writeText(name, content) {
      await client.writeFile(target(name), content);
    },
    async append(name, text) {
      await client.appendFile(target(name), text);
    },
    async readBinary(name, maxBytes) {
      return client.readBuffer(target(name), maxBytes);
    },
    async writeBinary(name, data) {
      await client.writeFile(target(name), data, true);
    },
    list,
    async exists(name) {
      const parent = path.posix.dirname(name);
      const entries = await list(parent === '.' ? '' : parent);
      return entries.some((entry) => entry.name === path.posix.basename(name));
    },
    async remove(name) {
      await client.deleteFile(target(name));
    },
    localPath: () => null,
  };
}
