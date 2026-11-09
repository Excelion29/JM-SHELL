import * as fs from 'fs-extra';
import * as path from 'path';
import { isKnowledgeTrusted } from '../config/knowledge-trust';
import { warn } from '../utils/format';
import { getSessionPin } from '../utils/session';
import { createIndexUpdater } from '../refinement/adr-index';
import { joinKnowledgePath, KnowledgeConfig, resolveAdrFolder } from '../refinement/knowledge';
import { createRestClient } from '../refinement/knowledge-rest';
import { createLocalStore } from '../refinement/local-store';
import { migrateLocalStory } from '../refinement/migrate';
import { linkStoryNote, NOTES_VERSION, repairStoryNotes, taskNoteKeys } from '../refinement/note-links';
import { loadPlan } from '../refinement/plan';
import { createProjectStore } from '../refinement/project-store';
import { JM_DIR } from '../refinement/safe-fs';
import { assertKey, isValidIssueKey, listStoriesFrom, readState, STORIES_DIR, updateState } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import type { StoryState } from '../refinement/types';
import { createVaultStore } from '../refinement/vault-store';
import { readKnowledgeConfig, resolveMcpAccess } from './knowledge-runtime';

// Listar la base con muchas historias no debe abrir decenas de conexiones a la vez
const LISTING_CONCURRENCY = 4;
// Listar la base en cada repintado del inicio sería lento; los cambios propios invalidan el listado antes
const LISTING_TTL_MS = 30_000;

export interface StoryAccess {
  store: StoryStore;
  // Aviso de la migración (respaldo por conflicto, archivos que no se movieron)
  notice?: string;
}

interface KnowledgeFolders {
  // Almacén de la carpeta JM-ADR (índice) y fábrica del almacén de cada historia
  adrStore: StoryStore;
  storeFor: (key: string) => StoryStore;
  close: () => void;
}

const cache = new Map<string, Promise<StoryAccess>>();
const listingCache = new Map<string, { at: number; states: StoryState[] }>();
const closers: Array<() => void> = [];

// Libera las conexiones de la sesión (los clientes REST mantienen sockets abiertos)
export function closeStoryStores(): void {
  cache.clear();
  listingCache.clear();
  while (closers.length) closers.pop()?.();
}

const configSignature = (config: KnowledgeConfig | null) => JSON.stringify(config);

async function assertTrusted(root: string, config: KnowledgeConfig, secretsDir?: string): Promise<void> {
  if (!(await isKnowledgeTrusted(root, config, secretsDir)))
    throw new Error(
      'La base de conocimiento de este .jira.json aún no está confirmada. Vuelve a entrar a la historia.',
    );
}

const unreachable = (target: string, err: unknown) =>
  new Error(`No pude conectar con la base de conocimiento (${target}): ${(err as Error).message}`);

async function mcpFolders(
  config: Extract<KnowledgeConfig, { type: 'mcp' }>,
  secretsDir?: string,
): Promise<KnowledgeFolders> {
  const access = await resolveMcpAccess(config, secretsDir);
  const client = createRestClient({ origin: access.origin, apiKey: access.apiKey, ca: access.ca });
  let adrFolder: string;
  try {
    const entries = await client.listDir(config.baseFolder);
    adrFolder = resolveAdrFolder(entries.filter((e) => e.isFolder).map((e) => e.name));
  } catch (err: unknown) {
    client.close();
    throw unreachable(access.host, err);
  }
  const adrDir = joinKnowledgePath(config.baseFolder, adrFolder);
  const storeAt = (dir: string) =>
    createVaultStore({ client, baseFolder: config.baseFolder, dir, label: `${access.host}:${dir}` });
  return {
    adrStore: storeAt(adrDir),
    storeFor: (key) => storeAt(joinKnowledgePath(adrDir, key)),
    close: () => client.close(),
  };
}

// La carpeta JM-ADR debe quedar dentro de la raíz aun si hay enlaces en el camino
async function assertInsideRoot(root: string, dir: string): Promise<void> {
  const [realRoot, realDir] = await Promise.all([fs.realpath(root), fs.realpath(dir)]);
  const relative = path.relative(realRoot, realDir);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('La carpeta JM-ADR sale de la carpeta de la base de conocimiento.');
}

async function localFolders(config: Extract<KnowledgeConfig, { type: 'local' }>): Promise<KnowledgeFolders> {
  const baseDir = path.join(config.root, ...config.baseFolder.split('/'));
  let folders: string[];
  try {
    folders = (await fs.readdir(baseDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err: unknown) {
    throw unreachable(config.root, err);
  }
  await assertInsideRoot(config.root, baseDir);
  const adrDir = path.join(baseDir, resolveAdrFolder(folders));
  if (await fs.lstat(adrDir).catch(() => null)) await assertInsideRoot(config.root, adrDir);
  await fs.ensureDir(adrDir);
  await assertInsideRoot(config.root, adrDir);
  const storeAt = (dir: string) => createLocalStore({ kind: 'local', anchor: adrDir, dir });
  return { adrStore: storeAt(adrDir), storeFor: (key) => storeAt(path.join(adrDir, key)), close: () => undefined };
}

export interface ResolverOptions {
  // Solo cambia en las pruebas: por defecto es ~/.jira-tool
  secretsDir?: string;
}

async function knowledgeFoldersOf(
  root: string,
  config: KnowledgeConfig,
  secretsDir?: string,
): Promise<KnowledgeFolders | null> {
  if (config.type === 'none') return null;
  await assertTrusted(root, config, secretsDir);
  return config.type === 'mcp' ? mcpFolders(config, secretsDir) : localFolders(config);
}

// La nota de la historia (<CLAVE>.md en JM-ADR) la escribe Claude; jm solo pone al día la ficha y su sección de tareas
async function syncStoryNote(
  adrStore: StoryStore,
  store: StoryStore,
  state: StoryState,
  withNote: ReadonlySet<string>,
): Promise<void> {
  const name = `${state.key}.md`;
  const note = await adrStore.readText(name);
  if (note === null) return;
  const plan = await loadPlan(store).catch(() => null);
  const next = linkStoryNote(note, state, plan, withNote);
  if (next !== note) await adrStore.writeText(name, next);
}

// Repara una sola vez las notas que dejaron versiones anteriores de jm; un fallo avisa y no impide abrir la historia
async function repairNotesOnce(store: StoryStore, key: string): Promise<void> {
  try {
    const state = await readState(store, key);
    if (!state || (state.notesVersion ?? 0) >= NOTES_VERSION) return;
    await repairStoryNotes(store, key);
    await updateState(store, key, (s) => {
      s.notesVersion = NOTES_VERSION;
    });
  } catch (err: unknown) {
    warn(`No pude enlazar las notas de ${key} en la base: ${(err as Error).message}`);
  }
}

async function openStoryUncached(root: string, key: string, options: ResolverOptions): Promise<StoryAccess> {
  const config = await readKnowledgeConfig(root);
  const folders = config ? await knowledgeFoldersOf(root, config, options.secretsDir) : null;
  if (!folders) return { store: createProjectStore(root, key) };
  closers.push(folders.close);
  const store = folders.storeFor(key);
  const updateIndex = createIndexUpdater(folders.adrStore);
  store.onStoryChanged = async (state) => {
    listingCache.delete(root);
    // Si no se puede listar tareas/, el índice se actualiza igual (sin enlaces nuevos)
    const withNote = await taskNoteKeys(store).catch(() => new Set<string>());
    await updateIndex(state, withNote);
    await syncStoryNote(folders.adrStore, store, state, withNote);
  };
  const migration = await migrateLocalStory(root, key, store);
  await repairNotesOnce(store, key);
  return { store, notice: migration.notice };
}

// Dónde vive la historia: la base conectada (con migración de lo que haya en .jm) o .jm del proyecto
export async function openStory(root: string, key: string, options: ResolverOptions = {}): Promise<StoryAccess> {
  assertKey(key);
  const config = await readKnowledgeConfig(root);
  const cacheKey = `${root}\n${key}\n${configSignature(config)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    if (config && config.type !== 'none') await assertTrusted(root, config, options.secretsDir);
    return cached;
  }
  const opening = openStoryUncached(root, key, options);
  cache.set(cacheKey, opening);
  opening.catch(() => cache.delete(cacheKey));
  return opening;
}

export async function storyStoreFor(root: string, key: string, options: ResolverOptions = {}): Promise<StoryStore> {
  return (await openStory(root, key, options)).store;
}

interface ListedStore {
  key: string;
  store: StoryStore;
}

function localKeys(root: string): string[] {
  const dir = path.join(root, JM_DIR, STORIES_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(isValidIssueKey) : [];
}

async function knowledgeKeys(folders: KnowledgeFolders): Promise<string[]> {
  const entries = await folders.adrStore.list('');
  return entries.filter((e) => !e.isFile && isValidIssueKey(e.name)).map((e) => e.name);
}

// Cuántas historias hay en la ubicación que describe `config` (null: .jm del proyecto)
export async function countStories(
  root: string,
  config: KnowledgeConfig | null,
  options: ResolverOptions = {},
): Promise<number> {
  if (!config || config.type === 'none') return localKeys(root).length;
  const folders = await knowledgeFoldersOf(root, config, options.secretsDir);
  if (!folders) return 0;
  try {
    return (await knowledgeKeys(folders)).length;
  } finally {
    folders.close();
  }
}

async function readInBatches(listed: ListedStore[]): Promise<StoryState[]> {
  const result: StoryState[] = [];
  for (let start = 0; start < listed.length; start += LISTING_CONCURRENCY) {
    result.push(...(await listStoriesFrom(listed.slice(start, start + LISTING_CONCURRENCY))));
  }
  return result;
}

export const PENDING_MOVE_SUFFIX = ' (por mover a la base)';

interface Listing {
  states: StoryState[];
  // Solo un listado completo de la base se guarda en la caché de la sesión
  complete: boolean;
}

const localListing = async (root: string, local: string[]): Promise<StoryState[]> =>
  listStoriesFrom(local.map((key) => ({ key, store: createProjectStore(root, key) })));

async function listFromKnowledge(
  root: string,
  config: KnowledgeConfig,
  local: string[],
  secretsDir?: string,
): Promise<StoryState[]> {
  const folders = await knowledgeFoldersOf(root, config, secretsDir);
  if (!folders) return [];
  try {
    const remoteKeys = await knowledgeKeys(folders);
    const states = await readInBatches(remoteKeys.map((key) => ({ key, store: folders.storeFor(key) })));
    const pending = local.filter((key) => !remoteKeys.includes(key));
    const moving = (await localListing(root, pending)).map((state) => ({
      ...state,
      summary: `${state.summary}${PENDING_MOVE_SUFFIX}`,
    }));
    return [...states, ...moving].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    folders.close();
  }
}

async function listUncached(root: string, options: ResolverOptions): Promise<Listing> {
  const config = await readKnowledgeConfig(root);
  const local = localKeys(root);
  const useKnowledge =
    config !== null && config.type !== 'none' && (config.type === 'local' || getSessionPin() !== null);
  if (!useKnowledge) return { states: await localListing(root, local), complete: false };
  try {
    return { states: await listFromKnowledge(root, config, local, options.secretsDir), complete: true };
  } catch (err: unknown) {
    warn(`No pude listar la base de conocimiento; muestro solo lo que hay en .jm. ${(err as Error).message}`);
    return { states: await localListing(root, local), complete: false };
  }
}

// Historias de la base y las de .jm que aún no se movieron (marcadas); sin PIN no se puede abrir una base MCP
export async function listAllStories(root: string, options: ResolverOptions = {}): Promise<StoryState[]> {
  const cached = listingCache.get(root);
  if (cached && Date.now() - cached.at < LISTING_TTL_MS) return [...cached.states];
  const listing = await listUncached(root, options);
  if (listing.complete) listingCache.set(root, { at: Date.now(), states: listing.states });
  return [...listing.states];
}
