import * as fs from 'fs-extra';
import * as path from 'path';
import { saveKnowledgeCert, saveKnowledgeKey } from '../config/knowledge-secrets';
import { isKnowledgeTrusted, trustKnowledge } from '../config/knowledge-trust';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { writeFileAtomicNoLinks } from '../utils/safe-write';
import { getSessionPin } from '../utils/session';
import type {
  KnowledgeChoice,
  KnowledgeConnection,
  KnowledgeListing,
  KnowledgeStatus,
  KnowledgeSummary,
  ServerInspection,
} from '../refinement/chat-types';
import { isNormalizedAbsolutePath } from '../refinement/claude';
import { assertLocalRootAllowed } from '../refinement/local-root';
import { isHttpsUrl, isValidBaseFolder, KnowledgeConfig, normalizeMcpUrl, resolveAdrFolder } from '../refinement/knowledge';
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
import { readKnowledgeConfig } from './knowledge-runtime';

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
  choice: Exclude<KnowledgeChoice, { type: 'none' }>,
  secretsDir: string | undefined,
  verifyMcp: McpVerifier,
): Promise<KnowledgeConfig> {
  const { connection, baseFolder } = choice;
  assertValidFolder(baseFolder);
  if (baseFolder === '') throw new Error('Elige una carpeta dentro de la bóveda como base, no la raíz.');
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
  const knowledge = choice.type === 'none' ? { type: 'none' as const } : await toConfig(choice, secretsDir, verifyMcp);
  writeFileAtomicNoLinks(
    path.join(root, PROJECT_CONFIG_NAME),
    `${JSON.stringify({ ...project, knowledge }, null, 2)}\n`,
  );
  await trustKnowledge(root, knowledge, secretsDir);
}
