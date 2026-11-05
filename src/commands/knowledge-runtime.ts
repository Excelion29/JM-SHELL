import * as fs from 'fs-extra';
import * as path from 'path';
import { loadKnowledgeCert, loadKnowledgeKey } from '../config/knowledge-secrets';
import { isKnowledgeTrusted } from '../config/knowledge-trust';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { getSessionPin } from '../utils/session';
import type { ChatKnowledge } from '../refinement/chat-types';
import { writeKnowledgeContext, writeMcpConfig } from '../refinement/chat-store';
import { assertSafeArgs } from '../refinement/claude';
import { startKbProxy } from '../refinement/kb-proxy';
import {
  adrNotePath,
  chooseStartMessage,
  joinKnowledgePath,
  KnowledgeConfig,
  knowledgeContextLine,
  normalizeMcpUrl,
  parseKnowledgeConfig,
  resolveAdrFolder,
  StartMessage,
} from '../refinement/knowledge';
import { verifyMcpEndpoint } from '../refinement/knowledge-rest';
import { createLocalSource, createRestSource, KnowledgeSource } from '../refinement/knowledge-source';
import { hasLogProgress } from '../refinement/state';

// Reglas de permisos de Claude: estos caracteres rompen la sintaxis de Write(<ruta>/**)
const RULE_UNSAFE_CHARS = /[()*?[\]{}]/;
const BACKSLASH = /\\/g;

export interface KnowledgeRuntime {
  kb: ChatKnowledge | null;
  proxyUrl: string | null;
  context: string | null;
  startMessage: StartMessage;
  close: () => Promise<void>;
}

export interface OpenKnowledgeInput {
  root: string;
  key: string;
  hasSession: boolean;
  // Solo cambia en las pruebas: por defecto es ~/.jira-tool
  secretsDir?: string;
}

const NO_KNOWLEDGE: Omit<KnowledgeRuntime, 'startMessage'> = {
  kb: null,
  proxyUrl: null,
  context: null,
  close: async () => undefined,
};

// null: no hay .jira.json o aún no tiene el campo `knowledge`
export async function readKnowledgeConfig(root: string): Promise<KnowledgeConfig | null> {
  const file = path.join(root, PROJECT_CONFIG_NAME);
  if (!(await fs.pathExists(file))) return null;
  const raw = ((await fs.readJson(file)) as { knowledge?: unknown }).knowledge;
  if (raw === undefined) return null;
  const config = parseKnowledgeConfig(raw);
  if (!config)
    throw new Error(`El campo "knowledge" de ${file} no es válido. Corrígelo o bórralo para configurarlo de nuevo.`);
  return config;
}

const unreachable = (target: string, err: unknown) =>
  new Error(`No pude conectar con la base de conocimiento (${target}): ${(err as Error).message}`);

async function listEntries(source: KnowledgeSource, dir: string, target: string) {
  try {
    return await source.listChildren(dir);
  } catch (err: unknown) {
    throw unreachable(target, err);
  }
}

const folderNames = (entries: Array<{ name: string; isFolder: boolean }>) =>
  entries.filter((entry) => entry.isFolder).map((entry) => entry.name);

async function openMcp(
  config: Extract<KnowledgeConfig, { type: 'mcp' }>,
  input: OpenKnowledgeInput,
): Promise<KnowledgeRuntime> {
  const { host, origin } = new URL(config.url);
  const pin = getSessionPin();
  const apiKey = pin ? await loadKnowledgeKey(config.url, pin, input.secretsDir) : null;
  if (!apiKey)
    throw new Error(
      `No encuentro la API key de ${host}. Borra el campo "knowledge" del .jira.json para configurarla de nuevo.`,
    );
  // Un certificado fijado para este host manda sobre lo que diga el .jira.json de la carpeta
  const ca = (await loadKnowledgeCert(config.url, input.secretsDir)) ?? undefined;
  if (config.tls === 'pinned' && !ca)
    throw new Error(`No encuentro el certificado guardado de ${host}. Configura la base de nuevo.`);

  const source = createRestSource({ origin, apiKey, ca });
  let notePath: string;
  let noteExists: boolean;
  try {
    const folders = folderNames(await listEntries(source, config.baseFolder, host));
    const adrFolder = resolveAdrFolder(folders);
    notePath = adrNotePath(config.baseFolder, adrFolder, input.key);
    // Se mira el listado de la carpeta JM-ADR en vez de descargar la nota
    noteExists =
      folders.includes(adrFolder) &&
      (await listEntries(source, joinKnowledgePath(config.baseFolder, adrFolder), host)).some(
        (entry) => entry.name === `${input.key}.md`,
      );
  } finally {
    source.close();
  }
  // Una URL guardada sin ruta (solo el origen) se cura aquí: el MCP vive en /mcp
  const mcpUrl = normalizeMcpUrl(config.url);
  await verifyMcpEndpoint({ url: mcpUrl, apiKey, ca }).catch((err: unknown) => {
    throw unreachable(host, err);
  });
  // Antes de abrir el intermediario: si esto falla no queda un servidor local huérfano
  const startMessage = await startMessageFor(input, noteExists);
  const proxy = await startKbProxy({
    upstreamUrl: mcpUrl,
    apiKey,
    ca,
    baseFolder: config.baseFolder,
  }).catch((err: unknown) => {
    throw new Error(`No pude abrir el intermediario local de la base de conocimiento: ${(err as Error).message}`);
  });
  return {
    kb: { type: 'mcp' },
    proxyUrl: proxy.url,
    context: knowledgeContextLine(config, notePath),
    startMessage,
    close: proxy.close,
  };
}

async function startMessageFor(input: OpenKnowledgeInput, noteExists: boolean): Promise<StartMessage> {
  return chooseStartMessage({
    hasSession: input.hasSession,
    hasLocalLog: await hasLogProgress(input.root, input.key),
    noteExists,
  });
}

function assertLocalRootUsable(root: string): void {
  try {
    assertSafeArgs(['--add-dir', root]);
  } catch {
    throw new Error(
      `La carpeta "${root}" tiene caracteres que Claude no admite en la línea de comandos (% " ! ^ & | < >) o termina en barra.`,
    );
  }
}

async function openLocal(
  config: Extract<KnowledgeConfig, { type: 'local' }>,
  input: OpenKnowledgeInput,
): Promise<KnowledgeRuntime> {
  assertLocalRootUsable(config.root);
  const source = createLocalSource(config.root);
  const folders = folderNames(await listEntries(source, config.baseFolder, config.root));
  const adrFolder = resolveAdrFolder(folders);
  const adrDir = path.join(config.root, ...joinKnowledgePath(config.baseFolder, adrFolder).split('/'));
  const ruleDir = adrDir.replace(BACKSLASH, '/');
  if (RULE_UNSAFE_CHARS.test(ruleDir))
    throw new Error(
      `La ruta "${ruleDir}" tiene caracteres que no puedo usar en un permiso de Claude: ( ) * ? [ ] { }.`,
    );
  await fs.ensureDir(adrDir);
  const notePath = adrNotePath(ruleDir, '', input.key);
  const noteExists = await fs.pathExists(path.join(adrDir, `${input.key}.md`));
  return {
    kb: { type: 'local', root: config.root, adrDir: ruleDir },
    proxyUrl: null,
    context: knowledgeContextLine(config, notePath),
    startMessage: await startMessageFor(input, noteExists),
    close: async () => undefined,
  };
}

// Bloquea (lanza) si la base configurada no responde: el chat no debe abrirse a ciegas
export async function openKnowledge(input: OpenKnowledgeInput): Promise<KnowledgeRuntime> {
  const config = await readKnowledgeConfig(input.root);
  if (!config || config.type === 'none') return { ...NO_KNOWLEDGE, startMessage: await startMessageFor(input, false) };
  if (!(await isKnowledgeTrusted(input.root, config, input.secretsDir)))
    throw new Error('La base de conocimiento de este .jira.json aún no está confirmada. Vuelve a entrar a la historia.');
  return config.type === 'mcp' ? openMcp(config, input) : openLocal(config, input);
}

// Archivos que Claude lee al arrancar; el de contexto se borra cuando ya no hay base conectada
export function applyKnowledgeFiles(root: string, runtime: KnowledgeRuntime): void {
  if (runtime.proxyUrl) writeMcpConfig(root, runtime.proxyUrl);
  writeKnowledgeContext(root, runtime.context);
}
