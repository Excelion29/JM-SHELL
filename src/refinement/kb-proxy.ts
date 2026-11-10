import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import type { AddressInfo } from 'net';
import { pipeline } from 'stream';
import { createKnowledgeAgent } from './knowledge-tls';

export const KB_SERVER_NAME = 'jm_kb';
// Lectura/búsqueda y escritura de notas; nada de borrar, mover, copiar ni ejecutar comandos
export const KB_ALLOWED_TOOLS = [
  'vault_list',
  'vault_read',
  'vault_get_document_map',
  'search_simple',
  'search_query',
  'tag_list',
  'vault_write',
  'vault_append',
] as const;
export const kbToolRule = (tool: string) => `mcp__${KB_SERVER_NAME}__${tool}`;

const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);
export const PROXY_PATH = '/mcp';
const TOKEN_BYTES = 16;
const BODY_MAX_BYTES = 10 * 1024 * 1024;
const FILTER_MAX_BYTES = 5 * 1024 * 1024;
const FILTER_TIMEOUT_MS = 15_000;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_INVALID_PARAMS = -32602;
const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_BAD_GATEWAY = 502;
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
// Cabeceras de conexión: cada salto (cliente-proxy, proxy-servidor) negocia las suyas
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
]);
const PROXIED_METHODS = new Set(['POST', 'GET', 'DELETE']);
const TOOLS_LIST = 'tools/list';
const TOOLS_CALL = 'tools/call';
const ALLOWED_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  TOOLS_LIST,
  TOOLS_CALL,
]);
const SSE_EVENT_SEPARATOR = '\n\n';
const SSE_LINE_BREAK = /\r\n?/g;
const SSE_DATA_PREFIX = /^data: ?/;
// Un navegador siempre manda Origin o Sec-Fetch-*; Claude Code (cliente HTTP nativo) no
const BROWSER_HEADER = /^(origin|sec-fetch-)/i;
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

const ALLOWED = new Set<string>(KB_ALLOWED_TOOLS);
// Todas reciben la ruta en el argumento "path" (esquema real de tools/list del servidor)
const PATH_ARG = 'path';
const PATH_TOOLS = new Set(['vault_list', 'vault_read', 'vault_get_document_map', 'vault_write', 'vault_append']);
const WRITE_TOOLS = new Set(['vault_write', 'vault_append']);
const VAULT_LIST_TOOL = 'vault_list';
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\:*?"<>|%]/;
const UNICODE_NORMAL_FORM = 'NFKC';
// Claves de argumentos que jm admite por herramienta; cualquier otra clave no se reenvía
const TOOL_ARGUMENT_KEYS: Record<(typeof KB_ALLOWED_TOOLS)[number], ReadonlySet<string>> = {
  // Claves según el inputSchema real del plugin Local REST API v5.5.2
  vault_list: new Set([PATH_ARG]),
  vault_read: new Set([PATH_ARG, 'targetType', 'target', 'scope']),
  vault_get_document_map: new Set([PATH_ARG]),
  vault_write: new Set([PATH_ARG, 'content', 'ifMatch', 'ifNoneMatch']),
  vault_append: new Set([PATH_ARG, 'content', 'ifMatch', 'ifNoneMatch']),
  search_simple: new Set(['query', 'contextLength', 'maxResults', 'maxMatchesPerFile']),
  search_query: new Set(['query']),
  tag_list: new Set(),
};

export interface KbProxyOptions {
  upstreamUrl: string;
  apiKey: string;
  // Carpeta base configurada: las escrituras solo caben dentro de ella
  baseFolder: string;
  // Si se indica, las escrituras solo caben aquí (p. ej. la carpeta de un análisis); las lecturas siguen en toda la bóveda
  writeFolder?: string;
  // Rutas de la bóveda (archivo o carpeta) donde nunca se escribe, ni dentro de writeFolder
  writeDenied?: readonly string[];
  // Certificado fijado por el dev; sin él se verifica con las autoridades del sistema
  ca?: string;
  // Tope y plazo para leer la lista de herramientas completa antes de filtrarla
  filterLimits?: { maxBytes: number; timeoutMs: number };
  // Cliente HTTPS hacia el servidor real; las pruebas lo reemplazan por uno falso
  request?: typeof https.request;
}

export interface KbProxy {
  // Lleva un token aleatorio en la ruta: solo quien lee el mcp.json de la carpeta de trabajo puede usar el intermediario
  url: string;
  close: () => Promise<void>;
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function filterToolsResult(message: unknown): unknown {
  // Un lote podría esconder herramientas prohibidas dentro de otra respuesta
  if (Array.isArray(message)) throw new Error('El servidor respondió un lote, que jm no admite.');
  if (!isRecord(message) || !isRecord(message.result) || !Array.isArray(message.result.tools)) return message;
  const tools = message.result.tools.filter(
    (tool) => isRecord(tool) && typeof tool.name === 'string' && ALLOWED.has(tool.name),
  );
  return { ...message, result: { ...message.result, tools } };
}

function tryParseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null; // un evento que no es JSON (p. ej. un comentario o ping) pasa tal cual
  }
}

function filterSseEvent(event: string): string {
  const lines = event.split('\n');
  const dataLines = lines.filter((line) => SSE_DATA_PREFIX.test(line));
  if (dataLines.length === 0) return event;
  const parsed = tryParseJson(dataLines.map((line) => line.replace(SSE_DATA_PREFIX, '')).join('\n'));
  if (!parsed) return event;
  const filtered = filterToolsResult(parsed.value);
  if (filtered === parsed.value) return event;
  const others = lines.filter((line) => !SSE_DATA_PREFIX.test(line));
  return [...others, `data: ${JSON.stringify(filtered)}`].join('\n');
}

// Se normalizan CR/CRLF a LF: así el separador de eventos es uno solo y no hay forma de esconder un evento
export function filterSseText(text: string): string {
  return text
    .replace(SSE_LINE_BREAK, '\n')
    .split(SSE_EVENT_SEPARATOR)
    .map((event) => (event === '' ? event : filterSseEvent(event)))
    .join(SSE_EVENT_SEPARATOR);
}

const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

// Ruta relativa a la bóveda: sin absolutas, "..", "\" ni segmentos que empiecen por "." (.obsidian, .git...)
const WINDOWS_ALIAS_SEGMENT = /[. ]$|~\d/;
const isUnder = (path: string, entry: string): boolean => path === entry || path.startsWith(`${entry}/`);

export function checkKbPath(
  value: unknown,
  baseFolder: string,
  mustBeInsideBase: boolean,
  writeDenied: readonly string[] = [],
): string | null {
  if (typeof value !== 'string') return `falta el argumento "${PATH_ARG}" o no es texto`;
  if (value.startsWith('/')) return 'la ruta no puede ser absoluta';
  if (value.includes('..')) return 'la ruta no puede contener ".."';
  if (UNSAFE_PATH_CHARS.test(value)) return 'la ruta tiene caracteres no permitidos';
  // Un punto "parecido" (U+FF0E, U+2024) se volvería ".." al normalizar en el servidor
  if (value.normalize(UNICODE_NORMAL_FORM) !== value) return 'la ruta tiene caracteres Unicode no permitidos';
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  if (trimmed !== '' && trimmed.split('/').some((segment) => segment === '' || segment.startsWith('.')))
    return 'la ruta no puede tener segmentos vacíos ni que empiecen por "."';
  if (mustBeInsideBase) {
    // Windows quita el punto o espacio final y resuelve nombres cortos (ESTADO~1.JSO): burlarían la lista de denegados
    if (trimmed.split('/').some((segment) => WINDOWS_ALIAS_SEGMENT.test(segment)))
      return 'la ruta no puede terminar un segmento en punto o espacio ni usar nombres cortos (~1)';
    const prefix = baseFolder === '' ? '' : `${baseFolder}/`;
    if (trimmed === '' || !trimmed.startsWith(prefix))
      return `solo se puede escribir dentro de la carpeta base "${baseFolder || '/'}"`;
    // Minúsculas: la bóveda puede ser insensible a mayúsculas (NTFS, macOS)
    if (writeDenied.some((entry) => isUnder(trimmed.toLowerCase(), entry.toLowerCase())))
      return 'esa ruta es de solo lectura para Claude';
  }
  return null;
}

type Inspection =
  { kind: 'forward'; body: Buffer; isToolsList: boolean } | { kind: 'reply'; status: number; body?: unknown };

function refuse(parsed: Json, code: number, message: string): Inspection {
  if (parsed.id === undefined) return { kind: 'reply', status: HTTP_ACCEPTED };
  return { kind: 'reply', status: HTTP_OK, body: rpcError(parsed.id, code, message) };
}

function inspectToolCall(parsed: Json, baseFolder: string, writeDenied: readonly string[]): Inspection | null {
  const params = isRecord(parsed.params) ? parsed.params : {};
  if (typeof params.name !== 'string' || !ALLOWED.has(params.name))
    return refuse(
      parsed,
      JSON_RPC_METHOD_NOT_FOUND,
      `La herramienta "${String(params.name)}" no está permitida por jm.`,
    );
  const args = isRecord(params.arguments) ? params.arguments : {};
  const allowedKeys = TOOL_ARGUMENT_KEYS[params.name as keyof typeof TOOL_ARGUMENT_KEYS];
  const unknownKey = Object.keys(args).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined)
    return refuse(
      parsed,
      JSON_RPC_INVALID_PARAMS,
      `jm rechazó el argumento "${unknownKey}" de "${params.name}": no está permitido.`,
    );
  if (!PATH_TOOLS.has(params.name)) return null;
  // vault_list sin ruta lista la raíz (path es opcional en su esquema)
  if (params.name === VAULT_LIST_TOOL && args[PATH_ARG] === undefined) return null;
  const problem = checkKbPath(args[PATH_ARG], baseFolder, WRITE_TOOLS.has(params.name), writeDenied);
  return problem
    ? refuse(parsed, JSON_RPC_INVALID_PARAMS, `jm rechazó la ruta de "${params.name}": ${problem}.`)
    : null;
}

function inspectBody(raw: Buffer, baseFolder: string, writeDenied: readonly string[]): Inspection {
  const parsedJson = tryParseJson(raw.toString('utf8'));
  if (!parsedJson) {
    return {
      kind: 'reply',
      status: HTTP_BAD_REQUEST,
      body: rpcError(null, JSON_RPC_INVALID_REQUEST, 'JSON inválido.'),
    };
  }
  const parsed = parsedJson.value;
  // Un lote podría esconder una llamada prohibida entre otras: no se admiten lotes
  if (!isRecord(parsed)) {
    return {
      kind: 'reply',
      status: HTTP_BAD_REQUEST,
      body: rpcError(null, JSON_RPC_INVALID_REQUEST, 'Solo se admite un mensaje por pedido.'),
    };
  }
  if (typeof parsed.method !== 'string' || !ALLOWED_METHODS.has(parsed.method))
    return refuse(parsed, JSON_RPC_METHOD_NOT_FOUND, `El método "${String(parsed.method)}" no está permitido por jm.`);
  const refusal = parsed.method === TOOLS_CALL ? inspectToolCall(parsed, baseFolder, writeDenied) : null;
  if (refusal) return refusal;
  // Se reenvía lo ya parseado, no el texto crudo: así una clave duplicada no puede decir otra cosa al servidor
  return { kind: 'forward', body: Buffer.from(JSON.stringify(parsed)), isToolsList: parsed.method === TOOLS_LIST };
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        req.off('data', onData);
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }).end(text);
}

function sendBadGateway(res: http.ServerResponse, message: string): void {
  if (res.headersSent) res.destroy();
  else sendJson(res, HTTP_BAD_GATEWAY, rpcError(null, JSON_RPC_INVALID_REQUEST, message));
}

// Solo Host loopback con nuestro puerto: frena el rebinding de DNS desde una página web
function isLocalRequest(req: http.IncomingMessage, port: number): boolean {
  const remote = req.socket.remoteAddress ?? '';
  return LOOPBACK_ADDRESSES.has(remote) && req.headers.host === `${LOOPBACK_HOST}:${port}`;
}

const isBrowserRequest = (req: http.IncomingMessage) => Object.keys(req.headers).some((h) => BROWSER_HEADER.test(h));

function matchesRoute(pathname: string, route: string): boolean {
  const given = Buffer.from(pathname);
  const expected = Buffer.from(route);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function upstreamHeaders(
  req: http.IncomingMessage,
  apiKey: string,
  bodyLength: number | null,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { authorization: `Bearer ${apiKey}`, 'accept-encoding': 'identity' };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  if (bodyLength !== null) headers['content-length'] = bodyLength;
  return headers;
}

function clientHeaders(upstream: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name)) headers[name] = value;
  }
  return headers;
}

function collect(stream: http.IncomingMessage, limits: { maxBytes: number; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        stream.destroy();
        reject(err);
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => finish(new Error('El servidor tardó demasiado en responder.')), limits.timeoutMs);
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limits.maxBytes) finish(new Error('La respuesta del servidor es demasiado grande.'));
      else chunks.push(chunk);
    });
    stream.on('end', () => finish(null));
    stream.on('error', finish);
    stream.on('close', () => finish(new Error('El servidor cortó la respuesta.')));
  });
}

function filterJsonText(text: string): string {
  const parsed = tryParseJson(text);
  return parsed ? JSON.stringify(filterToolsResult(parsed.value)) : text;
}

async function relayFiltered(
  upstream: http.IncomingMessage,
  res: http.ServerResponse,
  limits: { maxBytes: number; timeoutMs: number },
): Promise<void> {
  const text = await collect(upstream, limits);
  const isSse = String(upstream.headers['content-type'] ?? '').includes('text/event-stream');
  const output = isSse ? filterSseText(text) : filterJsonText(text);
  res.writeHead(upstream.statusCode ?? HTTP_BAD_GATEWAY, {
    ...clientHeaders(upstream),
    'content-length': Buffer.byteLength(output),
  });
  res.end(output);
}

export async function startKbProxy(options: KbProxyOptions): Promise<KbProxy> {
  const upstream = new URL(options.upstreamUrl);
  if (upstream.protocol !== 'https:') throw new Error('El MCP de la base de conocimiento debe usar https.');
  // Base en la raíz sin carpeta de escritura dejaría escribir en toda la bóveda
  if (options.baseFolder === '' && !options.writeFolder)
    throw new Error('Con la raíz de la bóveda como base hace falta una carpeta de escritura.');
  const agent = createKnowledgeAgent(options.ca);
  const route = `${PROXY_PATH}/${crypto.randomBytes(TOKEN_BYTES).toString('hex')}`;
  const limits = options.filterLimits ?? { maxBytes: FILTER_MAX_BYTES, timeoutMs: FILTER_TIMEOUT_MS };
  const server = http.createServer();

  const forward = (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer | null, filter: boolean) => {
    const out = (options.request ?? https.request)(
      upstream,
      { method: req.method, agent, headers: upstreamHeaders(req, options.apiKey, body ? body.length : null) },
      (response) => {
        if (filter) {
          relayFiltered(response, res, limits).catch((err: Error) =>
            sendBadGateway(res, `No pude leer la respuesta de la base de conocimiento: ${err.message}`),
          );
          return;
        }
        res.writeHead(response.statusCode ?? HTTP_BAD_GATEWAY, clientHeaders(response));
        // pipeline destruye ambos extremos si el servidor aborta a medias o el cliente se va
        pipeline(response, res, () => undefined);
      },
    );
    out.on('error', (err) => sendBadGateway(res, `No pude hablar con la base de conocimiento: ${err.message}`));
    res.on('close', () => out.destroy());
    out.end(body ?? undefined);
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const { port } = server.address() as AddressInfo;
    if (!isLocalRequest(req, port) || isBrowserRequest(req)) return sendJson(res, HTTP_FORBIDDEN);
    if (!matchesRoute(new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`).pathname, route))
      return sendJson(res, HTTP_NOT_FOUND);
    if (!PROXIED_METHODS.has(req.method ?? '')) return sendJson(res, HTTP_METHOD_NOT_ALLOWED);
    if (req.method !== 'POST') return forward(req, res, null, false);
    if (!JSON_CONTENT_TYPE.test(req.headers['content-type'] ?? '')) return sendJson(res, HTTP_UNSUPPORTED_MEDIA_TYPE);
    const body = await readBody(req);
    if (body === null) {
      res.setHeader('connection', 'close');
      res.once('finish', () => req.destroy());
      return sendJson(res, HTTP_PAYLOAD_TOO_LARGE);
    }
    const inspection = inspectBody(body, options.writeFolder ?? options.baseFolder, options.writeDenied ?? []);
    if (inspection.kind === 'reply') return sendJson(res, inspection.status, inspection.body);
    forward(req, res, inspection.body, inspection.isToolsList);
  };

  server.on('request', (req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${LOOPBACK_HOST}:${port}${route}`,
    close: () =>
      new Promise<void>((resolve) => {
        agent.destroy();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
