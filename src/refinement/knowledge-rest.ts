import * as https from 'https';
import * as tls from 'tls';
import { createKnowledgeAgent, fingerprintOf } from './knowledge-tls';

const REST_TIMEOUT_MS = 8000;
const PEM_MARKER = '-----BEGIN CERTIFICATE-----';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const BODY_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_HTTPS_PORT = 443;
const UNTRUSTED_CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_UNTRUSTED',
]);

export interface RestEntry {
  name: string;
  isFolder: boolean;
}

export interface RestOptions {
  // Origen del servidor, p. ej. https://127.0.0.1:27124
  origin: string;
  apiKey: string;
  // Certificado fijado; sin él se verifica con las autoridades del sistema
  ca?: string;
}

export interface RestClient {
  listDir: (dir: string) => Promise<RestEntry[]>;
  // null si la nota no existe; con maxBytes se corta la descarga y se devuelve lo leído
  readFile: (file: string, maxBytes?: number) => Promise<string | null>;
  close: () => void;
}

export type TlsInspection = { tls: 'system' } | { tls: 'untrusted'; pem: string; fingerprint: string };

interface RawResponse {
  status: number;
  body: string;
}

function request(
  url: URL,
  options: https.RequestOptions,
  truncateAt?: number,
  payload?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let done = false;
    const req = https.request(url, { ...options, timeout: REST_TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = () => {
        done = true;
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      };
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (truncateAt !== undefined && size >= truncateAt) {
          chunks.push(chunk.subarray(0, chunk.length - (size - truncateAt)));
          finish();
          res.destroy();
        } else if (size > BODY_MAX_BYTES) req.destroy(new Error('La respuesta es demasiado grande.'));
        else chunks.push(chunk);
      });
      res.on('end', finish);
    });
    req.on('timeout', () => req.destroy(new Error('El servidor no respondió a tiempo.')));
    req.on('error', (err) => {
      if (!done) reject(err);
    });
    req.end(payload);
  });
}

const encodePath = (relative: string) => relative.split('/').map(encodeURIComponent).join('/');

function vaultUrl(origin: string, relative: string, isDir: boolean): URL {
  const trimmed = relative.replace(/\/+$/, '');
  const suffix = trimmed === '' ? '/' : `/${encodePath(trimmed)}${isDir ? '/' : ''}`;
  return new URL(`/vault${suffix}`, origin);
}

function parseListing(body: string): RestEntry[] {
  const parsed: unknown = JSON.parse(body);
  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files)) throw new Error('La respuesta del servidor no trae la lista de archivos.');
  return files
    .filter((name): name is string => typeof name === 'string')
    .map((name) => (name.endsWith('/') ? { name: name.slice(0, -1), isFolder: true } : { name, isFolder: false }));
}

function failure(status: number, what: string): Error {
  if (status === HTTP_UNAUTHORIZED) return new Error('La API key no es válida para este servidor.');
  return new Error(`El servidor respondió ${status} al ${what}.`);
}

export function createRestClient({ origin, apiKey, ca }: RestOptions): RestClient {
  const agent = createKnowledgeAgent(ca);
  const options: https.RequestOptions = { headers: { Authorization: `Bearer ${apiKey}` }, agent };
  return {
    async listDir(dir) {
      const res = await request(vaultUrl(origin, dir, true), options);
      if (res.status !== HTTP_OK) throw failure(res.status, `listar "${dir || '/'}"`);
      return parseListing(res.body);
    },
    async readFile(file, maxBytes) {
      const res = await request(vaultUrl(origin, file, false), options, maxBytes);
      if (res.status === HTTP_NOT_FOUND) return null;
      if (res.status !== HTTP_OK) throw failure(res.status, `leer "${file}"`);
      return res.body;
    },
    close: () => agent.destroy(),
  };
}

const derToPem = (der: Buffer) =>
  `${PEM_MARKER}\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;

// La huella sale del certificado que el servidor PRESENTA en el handshake: es el mismo que se fijará y se exigirá después
function peerCertificate(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: url.hostname,
        port: Number(url.port) || DEFAULT_HTTPS_PORT,
        rejectUnauthorized: false,
        timeout: REST_TIMEOUT_MS,
      },
      () => {
        const { raw } = socket.getPeerCertificate();
        socket.end();
        if (raw) resolve(derToPem(raw));
        else reject(new Error('El servidor no presentó un certificado.'));
      },
    );
    socket.on('timeout', () => socket.destroy(new Error('El servidor no respondió a tiempo.')));
    socket.on('error', reject);
  });
}

// Con las autoridades del sistema: si valida, no hay nada que fijar; si es autofirmado, devuelve su huella
export async function inspectServerTls(mcpUrl: string): Promise<TlsInspection> {
  const url = new URL(mcpUrl);
  try {
    await request(new URL('/', url.origin), {});
    return { tls: 'system' };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (!UNTRUSTED_CERT_CODES.has(code)) throw err;
  }
  const pem = await peerCertificate(url);
  return { tls: 'untrusted', pem, fingerprint: fingerprintOf(pem) };
}

const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_CLIENT_NAME = 'jm';
const LINE_BREAK = /\r?\n/;
const SSE_DATA_LINE = /^data: ?(.*)$/;
const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: MCP_CLIENT_NAME, version: '1' } },
});

function hasInitializeResult(body: string): boolean {
  const candidates = [body, ...body.split(LINE_BREAK).map((line) => SSE_DATA_LINE.exec(line)?.[1] ?? '')];
  return candidates.some((text) => {
    try {
      const parsed = JSON.parse(text) as { result?: unknown };
      return typeof parsed === 'object' && parsed !== null && parsed.result !== undefined;
    } catch {
      return false;
    }
  });
}

export interface McpEndpoint {
  url: string;
  apiKey: string;
  ca?: string;
}

// Confirma que la URL contesta como MCP (initialize), no solo que el servidor está vivo
export async function verifyMcpEndpoint({ url, apiKey, ca }: McpEndpoint): Promise<void> {
  const target = new URL(url);
  const hint = `La URL no responde como MCP; prueba con ${target.origin}/mcp`;
  const agent = createKnowledgeAgent(ca);
  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    const res = await request(target, { method: 'POST', headers, agent }, undefined, INITIALIZE_REQUEST);
    if (res.status === HTTP_UNAUTHORIZED) throw new Error('La API key no es válida para este servidor.');
    if (res.status !== HTTP_OK || !hasInitializeResult(res.body)) throw new Error(hint);
  } finally {
    agent.destroy();
  }
}
