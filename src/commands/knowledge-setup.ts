import * as fs from 'fs-extra';
import * as path from 'path';
import { loadKnowledgeCert, saveKnowledgeCert, saveKnowledgeKey } from '../config/knowledge-secrets';
import { isKnowledgeTrusted, trustKnowledge } from '../config/knowledge-trust';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { writeFileAtomicNoLinks } from '../utils/safe-write';
import { getSessionPin } from '../utils/session';
import type {
  KnowledgeChangeResult,
  KnowledgeChoice,
  KnowledgeConnection,
  KnowledgeListing,
  KnowledgeSettings,
  KnowledgeStatus,
  KnowledgeSummary,
  KnowledgeTarget,
  ServerInspection,
} from '../refinement/chat-types';
import { isNormalizedAbsolutePath, resetTrustedAddDirs } from '../refinement/claude';
import { assertLocalRootAllowed } from '../refinement/local-root';
import {
  isHttpsUrl,
  isValidBaseFolder,
  KnowledgeConfig,
  normalizeMcpUrl,
  resolveAdrFolder,
} from '../refinement/knowledge';
import { inspectServerTls, McpEndpoint, verifyMcpEndpoint } from '../refinement/knowledge-rest';
import {
  createLocalSource,
  createRestSource,
  KnowledgeSource,
  PREVIEW_MAX_BYTES,
  previewOf,
  sortEntries,
} from '../refinement/knowledge-source';
import { stripTerminalControls } from '../refinement/text';
import { readKnowledgeConfig, resolveMcpAccess } from './knowledge-runtime';
import { closeStoryStores, countStories } from './story-resolver';

// C0, DEL, C1, separadores de línea/párrafo y controles bidireccionales: escribirían en la terminal o disfrazarían el nombre
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

type ProjectFile = Record<string, unknown>;

async function readProjectFile(root: string): Promise<ProjectFile | null> {
  const file = path.join(root, PROJECT_CONFIG_NAME);
  return (await fs.pathExists(file)) ? ((await fs.readJson(file)) as ProjectFile) : null;
}

// Solo se pregunta cuando la carpeta ya tiene .jira.json con proyecto; 'untrusted': hay base pero nadie la confirmó aquí
// secretsDir solo cambia en las pruebas: por defecto es ~/.jira-tool
export async function knowledgeStatus(root: string, secretsDir?: string): Promise<KnowledgeStatus> {
  const project = await readProjectFile(root);
  if (typeof project?.projectKey !== 'string' || project.projectKey === '') return 'set';
  const config = await readKnowledgeConfig(root);
  if (config === null) return 'unset';
  return (await isKnowledgeTrusted(root, config, secretsDir)) ? 'set' : 'untrusted';
}

async function configToConfirm(root: string): Promise<Exclude<KnowledgeConfig, { type: 'none' }>> {
  const config = await readKnowledgeConfig(root);
  if (!config || config.type === 'none')
    throw new Error('Esta carpeta no tiene una base de conocimiento por confirmar.');
  if (config.type === 'local') assertLocalRootAllowed(config.root);
  return config;
}

export async function describeKnowledge(root: string): Promise<KnowledgeSummary> {
  const config = await configToConfirm(root);
  return {
    type: config.type,
    target: config.type === 'mcp' ? config.url : config.root,
    baseFolder: config.baseFolder,
  };
}

export async function confirmKnowledge(root: string, secretsDir?: string): Promise<void> {
  await trustKnowledge(root, await configToConfirm(root), secretsDir);
}

async function withSource<T>(
  connection: KnowledgeConnection,
  task: (source: KnowledgeSource) => Promise<T>,
): Promise<T> {
  const source =
    connection.type === 'local'
      ? createLocalSource(connection.root)
      : createRestSource({
          origin: new URL(connection.url).origin,
          apiKey: connection.apiKey,
          ca: connection.certPem ?? undefined,
        });
  try {
    return await task(source);
  } finally {
    source.close();
  }
}

function assertValidFolder(dir: string): void {
  if (!isValidBaseFolder(dir)) throw new Error(`La carpeta "${dir}" no es válida.`);
}

function assertSafeUrl(url: string): void {
  if (!isHttpsUrl(url)) throw new Error('El MCP debe usar https y la URL no puede llevar usuario ni contraseña.');
}

function assertSafeRoot(root: string): void {
  if (!isNormalizedAbsolutePath(root))
    throw new Error(`La carpeta "${root}" debe ser una ruta absoluta completa, sin ".." ni rutas de red (UNC).`);
  assertLocalRootAllowed(root);
}

export async function inspectServer(url: string): Promise<ServerInspection> {
  assertSafeUrl(url);
  return inspectServerTls(url);
}

export async function listKnowledge(connection: KnowledgeConnection, dir: string): Promise<KnowledgeListing> {
  assertValidFolder(dir);
  if (connection.type === 'local') assertSafeRoot(connection.root);
  // Un nombre con caracteres de control podría escribir en la terminal o romper la ruta: se omite
  const listed = (await withSource(connection, (source) => source.listChildren(dir))).filter(
    (entry) => !CONTROL_CHARS.test(entry.name),
  );
  const entries = sortEntries(listed);
  return { entries, adrFolder: resolveAdrFolder(entries.filter((e) => e.isFolder).map((e) => e.name)) };
}

export async function previewKnowledge(connection: KnowledgeConnection, file: string): Promise<string> {
  assertValidFolder(file.replace(/\.md$/, ''));
  if (connection.type === 'local') assertSafeRoot(connection.root);
  const content = await withSource(connection, (source) => source.readNote(file, PREVIEW_MAX_BYTES));
  if (content === null) throw new Error(`No encontré la nota "${file}".`);
  return stripTerminalControls(previewOf(content));
}

export type McpVerifier = (endpoint: McpEndpoint) => Promise<void>;

async function toConfig(
  connection: KnowledgeConnection,
  baseFolder: string,
  secretsDir: string | undefined,
  verifyMcp: McpVerifier,
): Promise<KnowledgeConfig> {
  assertValidFolder(baseFolder);
  if (connection.type === 'local') {
    assertSafeRoot(connection.root);
    return { type: 'local', root: connection.root, baseFolder };
  }
  assertSafeUrl(connection.url);
  const pin = getSessionPin();
  if (!pin) throw new Error('No tengo tu PIN en esta sesión. Reinicia jm e ingrésalo de nuevo.');
  const url = normalizeMcpUrl(connection.url);
  await verifyMcp({ url, apiKey: connection.apiKey, ca: connection.certPem ?? undefined });
  await saveKnowledgeKey(url, connection.apiKey, pin, secretsDir);
  if (connection.certPem) await saveKnowledgeCert(url, connection.certPem, secretsDir);
  return { type: 'mcp', url, baseFolder, tls: connection.certPem ? 'pinned' : 'system' };
}

// Misma conexión de la carpeta con otra carpeta base: no se toca la key ni el certificado
async function keepConnection(root: string, baseFolder: string): Promise<KnowledgeConfig> {
  assertValidFolder(baseFolder);
  const config = await configToConfirm(root);
  return { ...config, baseFolder };
}

async function configFor(
  root: string,
  choice: KnowledgeChoice,
  secretsDir: string | undefined,
  verifyMcp: McpVerifier,
): Promise<KnowledgeConfig> {
  if (choice.type === 'none') return { type: 'none' };
  if (choice.connection.type === 'current') return keepConnection(root, choice.baseFolder);
  return toConfig(choice.connection, choice.baseFolder, secretsDir, verifyMcp);
}

// La key y el certificado van a ~/.jira-tool; en el .jira.json solo queda dónde está la base
// Lo configurado aquí por el dev queda confirmado (confianza) para esta carpeta
export async function saveKnowledge(
  root: string,
  choice: KnowledgeChoice,
  secretsDir?: string,
  verifyMcp: McpVerifier = verifyMcpEndpoint,
): Promise<void> {
  const project = await readProjectFile(root);
  if (!project) throw new Error(`No hay ${PROJECT_CONFIG_NAME} en esta carpeta.`);
  const knowledge = await configFor(root, choice, secretsDir, verifyMcp);
  writeFileAtomicNoLinks(
    path.join(root, PROJECT_CONFIG_NAME),
    `${JSON.stringify({ ...project, knowledge }, null, 2)}\n`,
  );
  await trustKnowledge(root, knowledge, secretsDir);
}

// 'current' se resuelve aquí, en el lado de Node: la API key guardada no sale hacia la pantalla
export async function resolveTarget(
  root: string,
  target: KnowledgeTarget,
  secretsDir?: string,
): Promise<KnowledgeConnection> {
  if (target.type !== 'current') return target;
  const config = await readKnowledgeConfig(root);
  if (!config || config.type === 'none') throw new Error('Esta carpeta no tiene una base de conocimiento configurada.');
  if (config.type === 'local') return { type: 'local', root: config.root };
  const access = await resolveMcpAccess(config, secretsDir);
  return { type: 'mcp', url: config.url, apiKey: access.apiKey, certPem: access.ca ?? null };
}

const NO_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  type: 'none',
  target: null,
  baseFolder: null,
  adrFolder: null,
  connection: 'none',
  connectionError: null,
};

export async function knowledgeSettings(root: string, secretsDir?: string): Promise<KnowledgeSettings> {
  const config = await readKnowledgeConfig(root);
  if (!config || config.type === 'none') return NO_KNOWLEDGE_SETTINGS;
  const settings = {
    type: config.type,
    target: config.type === 'mcp' ? config.url : config.root,
    baseFolder: config.baseFolder,
  };
  try {
    const connection = await resolveTarget(root, { type: 'current' }, secretsDir);
    const listing = await listKnowledge(connection, config.baseFolder);
    return { ...settings, adrFolder: listing.adrFolder, connection: 'ok', connectionError: null };
  } catch (err: unknown) {
    return { ...settings, adrFolder: null, connection: 'unreachable', connectionError: (err as Error).message };
  }
}

// Las historias no se mueven: se cuentan en la ubicación anterior para avisar al dev (nada se pierde)
export async function changeKnowledge(
  root: string,
  choice: KnowledgeChoice,
  secretsDir?: string,
  verifyMcp: McpVerifier = verifyMcpEndpoint,
): Promise<KnowledgeChangeResult> {
  const previous = await readKnowledgeConfig(root);
  const leftBehind = await countStories(root, previous, { secretsDir }).catch(() => null);
  await saveKnowledge(root, choice, secretsDir, verifyMcp);
  closeStoryStores();
  resetTrustedAddDirs();
  const fromProject = !previous || previous.type === 'none';
  return { leftBehind, movesOnOpen: fromProject && choice.type !== 'none' };
}

// Solo cambia la key: la URL y la carpeta base siguen igual, así que la confianza guardada no se toca
export async function renewKnowledgeKey(
  root: string,
  apiKey: string,
  secretsDir?: string,
  verifyMcp: McpVerifier = verifyMcpEndpoint,
): Promise<void> {
  const config = await readKnowledgeConfig(root);
  if (!config || config.type !== 'mcp')
    throw new Error('Esta carpeta no usa una base MCP: no hay API key que renovar.');
  const pin = getSessionPin();
  if (!pin) throw new Error('No tengo tu PIN en esta sesión. Reinicia jm e ingrésalo de nuevo.');
  const ca = (await loadKnowledgeCert(config.url, secretsDir)) ?? undefined;
  if (config.tls === 'pinned' && !ca)
    throw new Error(
      'No encuentro el certificado guardado de este servidor. Cambia la conexión para configurarla de nuevo.',
    );
  await verifyMcp({ url: normalizeMcpUrl(config.url), apiKey, ca });
  await saveKnowledgeKey(config.url, apiKey, pin, secretsDir);
  closeStoryStores();
}
