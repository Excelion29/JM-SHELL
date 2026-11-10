import { CHAT_KEY_SOURCE, isNormalizedAbsolutePath } from './claude';
import { KB_SERVER_NAME } from './kb-proxy';

export const ADR_SUFFIX = 'JM-ADR';
const ADR_NUMBER_DIGITS = 2;
const FIRST_ADR_NUMBER = 0;
const NUMBER_PREFIX = /^(\d+)(?:\D|$)/;
const KEY_PATTERN = new RegExp(`^${CHAT_KEY_SOURCE}$`);
const UNSAFE_SEGMENT = /[\u0000-\u001f\\:*?"<>|]/;

export type KnowledgeTls = 'system' | 'pinned';

export type KnowledgeConfig =
  | { type: 'none' }
  | { type: 'mcp'; url: string; baseFolder: string; tls: KnowledgeTls }
  | { type: 'local'; root: string; baseFolder: string };

export type StartMessage = 'resume' | 'fromLog' | 'fromNote' | 'first';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Carpeta dentro de la base: segmentos con "/", sin "..", sin rutas absolutas ni caracteres de control
export function isValidBaseFolder(folder: string): boolean {
  if (folder === '') return true;
  return folder
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !UNSAFE_SEGMENT.test(segment));
}

// https sin usuario ni contraseña en la URL: un secreto no debe viajar en el .jira.json ni en los mensajes
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

// Ruta por defecto del MCP de Obsidian Local REST API; una URL sin ruta apunta al origen, no al MCP
export const DEFAULT_MCP_PATH = '/mcp';

// Se aplica al usar la URL, no al leerla: el hash de confianza sigue siendo el de lo guardado
export function normalizeMcpUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname === '' || url.pathname === '/') url.pathname = DEFAULT_MCP_PATH;
  return url.toString();
}

export function parseKnowledgeConfig(value: unknown): KnowledgeConfig | null {
  if (!isRecord(value)) return null;
  if (value.type === 'none') return { type: 'none' };
  const { baseFolder } = value;
  // baseFolder '' = raíz de la bóveda: Claude la lee entera pero solo escribe en la carpeta JM-ADR
  if (typeof baseFolder !== 'string' || !isValidBaseFolder(baseFolder)) return null;
  if (value.type === 'mcp') {
    const { url, tls } = value;
    if (typeof url !== 'string' || !isHttpsUrl(url) || (tls !== 'system' && tls !== 'pinned')) return null;
    return { type: 'mcp', url, baseFolder, tls };
  }
  if (value.type === 'local' && typeof value.root === 'string' && isNormalizedAbsolutePath(value.root)) {
    return { type: 'local', root: value.root, baseFolder };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(ADR_NUMBER_DIGITS, '0');

// Reusa la carpeta *JM-ADR existente; si no, NN-JM-ADR con el número siguiente al mayor (00 sin numeración)
// Un nombre con separadores saldría de la carpeta base al armar rutas
const PATH_SEPARATORS = /[\\/]/;

export function resolveAdrFolder(childNames: string[]): string {
  const existing = childNames.find((name) => name.endsWith(ADR_SUFFIX) && !PATH_SEPARATORS.test(name));
  if (existing) return existing;
  const numbers = childNames.flatMap((name) => {
    const match = NUMBER_PREFIX.exec(name);
    return match ? [Number(match[1])] : [];
  });
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : FIRST_ADR_NUMBER;
  return `${pad(next)}-${ADR_SUFFIX}`;
}

export const joinKnowledgePath = (...parts: string[]) => parts.filter((part) => part !== '').join('/');

export function adrNotePath(base: string, adrFolder: string, key: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error(`Clave de historia inválida para la nota: "${key}".`);
  return joinKnowledgePath(base, adrFolder, `${key}.md`);
}

export interface StartChoiceInput {
  hasSession: boolean;
  hasLocalLog: boolean;
  noteExists: boolean;
}

export function chooseStartMessage({ hasSession, hasLocalLog, noteExists }: StartChoiceInput): StartMessage {
  if (hasSession) return 'resume';
  if (hasLocalLog) return 'fromLog';
  return noteExists ? 'fromNote' : 'first';
}

const knowledgeWhere = (config: Exclude<KnowledgeConfig, { type: 'none' }>): string =>
  config.type === 'mcp'
    ? `por el MCP ${KB_SERVER_NAME} (carpeta base \`${config.baseFolder || '/'}\`)`
    : `en la carpeta local \`${config.root}\` (carpeta base \`${config.baseFolder || '/'}\`)`;

const copyHint = (attachmentsCopy?: string): string =>
  attachmentsCopy
    ? ` Los adjuntos binarios (imágenes, PDF) los abres desde la copia de solo lectura \`${attachmentsCopy}\`.`
    : '';

// Texto que viaja por stdin al arrancar: ubica la base, la carpeta de la historia y la nota de la historia
export function knowledgeContextLine(
  config: KnowledgeConfig,
  notePath: string,
  storyFolder: string,
  attachmentsCopy?: string,
): string {
  if (config.type === 'none') return '';
  return (
    `Tienes una base de conocimiento ${knowledgeWhere(config)}. Sigue la sección "Base de conocimiento" de la skill. ` +
    `La historia vive en la carpeta \`${storyFolder}\` de la base (no en el repositorio): ahí lees y escribes ` +
    `historia.md, bitacora.md, estado.json, plan.json y adjuntos/.${copyHint(attachmentsCopy)} ` +
    `Tu nota de esta historia es \`${notePath}\`.`
  );
}

// Un análisis no tiene nota propia: solo su carpeta, con las fuentes en fuentes/
export function analysisContextLine(config: KnowledgeConfig, analysisFolder: string, attachmentsCopy?: string): string {
  if (config.type === 'none') return '';
  return (
    `Tienes una base de conocimiento ${knowledgeWhere(config)}. Sigue la sección "Base de conocimiento" de la skill. ` +
    `El análisis vive en la carpeta \`${analysisFolder}\` de la base (no en el repositorio): ahí lees y escribes ` +
    `estado.json, bitacora.md, puntos.json y los 3 documentos; las fuentes están en fuentes/.${copyHint(attachmentsCopy)}`
  );
}

export interface LinkedAnalysisRef {
  id: string;
  name: string;
}

const LINKED_ANALYSIS_DOCS = 'análisis_propuesta.md, observaciones_funcional_tecnico.md, resumen_observaciones.md y puntos.json';

// Historia de la épica de un análisis vinculado: ese análisis es contexto de solo lectura
export function linkedAnalysisLine(analyses: LinkedAnalysisRef[], folderOf: (id: string) => string): string {
  if (analyses.length === 0) return '';
  const where = analyses.map((analysis) => `${analysis.id} (${analysis.name}) en \`${folderOf(analysis.id)}\``);
  return (
    `Esta historia es de la épica vinculada al análisis ${where.join('; ')}. Antes de refinar, lee de esa carpeta ` +
    `${LINKED_ANALYSIS_DOCS} (los que existan) y úsalos como contexto. Es solo lectura: no escribas ahí.`
  );
}
