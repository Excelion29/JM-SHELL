import * as fs from 'fs-extra';
import * as path from 'path';
import { loadKnowledgeCert, loadKnowledgeKey } from '../config/knowledge-secrets';
import { isKnowledgeTrusted } from '../config/knowledge-trust';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { getSessionPin } from '../utils/session';
import type { ChatKnowledge } from '../refinement/chat-types';
import { writeKnowledgeContext, writeMcpConfig } from '../refinement/chat-store';
import {
  ANALYSIS_DIR_NAME,
  ANALYSIS_SOURCES_NAME,
  ANALYSIS_STATE_NAME,
  isAnalysisKey,
  isSafeAddDirPath,
  resetTrustedAddDirs,
  trustAddDir,
  workFilesOf,
} from '../refinement/claude';
import { startKbProxy } from '../refinement/kb-proxy';
import {
  adrNotePath,
  analysisContextLine,
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
import { assertLocalRootAllowed } from '../refinement/local-root';
import { JM_DIR, safeEnsureDirIn } from '../refinement/safe-fs';
import { workDirFor } from '../refinement/workdir';

// Reglas de permisos de Claude: estos caracteres rompen la sintaxis de Write(<ruta>/**)
const RULE_UNSAFE_CHARS = /[()*?[\]{}]/;
const BACKSLASH = /\\/g;

export interface KnowledgeRuntime {
  kb: ChatKnowledge | null;
  proxyUrl: string | null;
  context: string | null;
  // Carpeta del análisis `id` según dónde vive la base (para darlo como contexto de solo lectura)
  analysisFolderOf: (id: string) => string;
  startMessage: StartMessage;
  close: () => Promise<void>;
}

export interface OpenKnowledgeInput {
  root: string;
  key: string;
  hasSession: boolean;
  // La bitácora de la historia ya tiene avance (se lee del almacén de la historia)
  hasLocalLog: boolean;
  // Solo cambia en las pruebas: por defecto es ~/.jira-tool
  secretsDir?: string;
}

const NO_KNOWLEDGE: Omit<KnowledgeRuntime, 'startMessage'> = {
  kb: null,
  proxyUrl: null,
  context: null,
  analysisFolderOf: (id) => `${JM_DIR}/${ANALYSIS_DIR_NAME}/${id}`,
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

export interface McpAccess {
  host: string;
  origin: string;
  apiKey: string;
  ca?: string;
}

// La API key y el certificado fijado viven cifrados en ~/.jira-tool: se abren con el PIN de la sesión
export async function resolveMcpAccess(
  config: Extract<KnowledgeConfig, { type: 'mcp' }>,
  secretsDir?: string,
): Promise<McpAccess> {
  const { host, origin } = new URL(config.url);
  const pin = getSessionPin();
  const apiKey = pin ? await loadKnowledgeKey(config.url, pin, secretsDir) : null;
  if (!apiKey)
    throw new Error(
      `No encuentro la API key de ${host}. Borra el campo "knowledge" del .jira.json para configurarla de nuevo.`,
    );
  // Un certificado fijado para este host manda sobre lo que diga el .jira.json de la carpeta
  const ca = (await loadKnowledgeCert(config.url, secretsDir)) ?? undefined;
  if (config.tls === 'pinned' && !ca)
    throw new Error(`No encuentro el certificado guardado de ${host}. Configura la base de nuevo.`);
  return { host, origin, apiKey, ca };
}

async function openMcp(
  config: Extract<KnowledgeConfig, { type: 'mcp' }>,
  input: OpenKnowledgeInput,
): Promise<KnowledgeRuntime> {
  const { host, origin, apiKey, ca } = await resolveMcpAccess(config, input.secretsDir);
  const source = createRestSource({ origin, apiKey, ca });
  const analysis = isAnalysisKey(input.key);
  let notePath = '';
  let adrFolder: string;
  let noteExists = false;
  try {
    const folders = folderNames(await listEntries(source, config.baseFolder, host));
    adrFolder = resolveAdrFolder(folders);
    // Un análisis no tiene nota en la raíz de JM-ADR
    if (!analysis) notePath = adrNotePath(config.baseFolder, adrFolder, input.key);
    // Se mira el listado de la carpeta JM-ADR en vez de descargar la nota
    noteExists =
      !analysis &&
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
  const startMessage = startMessageFor(input, noteExists);
  const proxy = await startKbProxy({
    upstreamUrl: mcpUrl,
    apiKey,
    ca,
    baseFolder: config.baseFolder,
    ...writeScopeFor(config.baseFolder, adrFolder, input),
  }).catch((err: unknown) => {
    throw new Error(`No pude abrir el intermediario local de la base de conocimiento: ${(err as Error).message}`);
  });
  return {
    kb: { type: 'mcp' },
    proxyUrl: proxy.url,
    context: analysis
      ? analysisContextLine(
          config,
          analysisFolder(config.baseFolder, adrFolder, input.key),
          workFilesOf(workDirFor(input.root), input.key).attachments,
        )
      : knowledgeContextLine(
          config,
          notePath,
          joinKnowledgePath(config.baseFolder, adrFolder, input.key),
          workFilesOf(workDirFor(input.root), input.key).attachments,
        ),
    analysisFolderOf: (id) => analysisFolder(config.baseFolder, adrFolder, id),
    startMessage,
    close: proxy.close,
  };
}

const analysisFolder = (baseFolder: string, adrFolder: string, id: string): string =>
  joinKnowledgePath(baseFolder, adrFolder, ANALYSIS_DIR_NAME, id);

// Claude escribe en la carpeta del análisis, salvo el estado de jm y las fuentes
const analysisWriteScope = (folder: string) => ({
  writeFolder: folder,
  writeDenied: [`${folder}/${ANALYSIS_STATE_NAME}`, `${folder}/${ANALYSIS_SOURCES_NAME}`],
});

// Con la raíz de la bóveda como base las escrituras se acotan a JM-ADR; con una carpeta base basta la propia base
function writeScopeFor(baseFolder: string, adrFolder: string, input: OpenKnowledgeInput) {
  if (isAnalysisKey(input.key)) return analysisWriteScope(analysisFolder(baseFolder, adrFolder, input.key));
  // Una historia no toca los análisis (su estado y fuentes son de jm)
  const writeDenied = [joinKnowledgePath(baseFolder, adrFolder, ANALYSIS_DIR_NAME)];
  return baseFolder === '' ? { writeFolder: adrFolder, writeDenied } : { writeDenied };
}

function startMessageFor(input: OpenKnowledgeInput, noteExists: boolean): StartMessage {
  return chooseStartMessage({ hasSession: input.hasSession, hasLocalLog: input.hasLocalLog, noteExists });
}

function assertLocalRootUsable(root: string): void {
  assertLocalRootAllowed(root);
  if (!isSafeAddDirPath(root)) {
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
  trustAddDir(config.root);
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
  const analysis = isAnalysisKey(input.key);
  const noteExists = !analysis && (await fs.pathExists(path.join(adrDir, `${input.key}.md`)));
  return {
    kb: { type: 'local', root: config.root, adrDir: ruleDir },
    proxyUrl: null,
    context: analysis
      ? analysisContextLine(config, analysisFolder(ruleDir, '', input.key))
      : knowledgeContextLine(config, adrNotePath(ruleDir, '', input.key), `${ruleDir}/${input.key}`),
    analysisFolderOf: (id) => analysisFolder(ruleDir, '', id),
    startMessage: startMessageFor(input, noteExists),
    close: async () => undefined,
  };
}

// Bloquea (lanza) si la base configurada no responde: el chat no debe abrirse a ciegas
export async function openKnowledge(input: OpenKnowledgeInput): Promise<KnowledgeRuntime> {
  resetTrustedAddDirs();
  const config = await readKnowledgeConfig(input.root);
  if (!config || config.type === 'none') return { ...NO_KNOWLEDGE, startMessage: startMessageFor(input, false) };
  if (!(await isKnowledgeTrusted(input.root, config, input.secretsDir)))
    throw new Error(
      'La base de conocimiento de este .jira.json aún no está confirmada. Vuelve a entrar a la historia.',
    );
  return config.type === 'mcp' ? openMcp(config, input) : openLocal(config, input);
}

// Archivos que Claude lee al arrancar, en la carpeta de trabajo de jm; el de contexto se borra cuando ya no hay base
export function applyKnowledgeFiles(workDir: string, runtime: KnowledgeRuntime, key: string): void {
  if (runtime.proxyUrl) writeMcpConfig(workDir, runtime.proxyUrl);
  // --add-dir exige que la carpeta exista aunque la historia aún no tenga adjuntos
  if (runtime.kb?.type === 'mcp') safeEnsureDirIn(workDir, workFilesOf(workDir, key).attachments);
  writeKnowledgeContext(workDir, runtime.context);
}
