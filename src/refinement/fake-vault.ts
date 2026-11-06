import * as https from 'https';
import type { AddressInfo } from 'net';
import { TEST_CERT_A, TEST_KEY_A } from './test-certs';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;
const VAULT_PREFIX = '/vault/';
const JSON_CONTENT_TYPE = /^application\/json/i;

export interface FakeVault {
  origin: string;
  // Contenido por ruta de la bóveda (sin "/" inicial)
  files: Map<string, Buffer>;
  requests: Array<{ method: string; path: string; contentType: string }>;
  close: () => Promise<void>;
}

function listing(files: Map<string, Buffer>, dir: string): string[] | null {
  const prefix = dir === '' ? '' : `${dir}/`;
  const names = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue;
    const [first, ...rest] = path.slice(prefix.length).split('/');
    names.add(rest.length > 0 ? `${first}/` : first);
  }
  return names.size > 0 ? [...names].sort() : null;
}

// Imita lo verificado contra el Obsidian real: PUT/POST/DELETE, application/json rechazado en PUT, listado sin tamaños,
// carpetas que desaparecen al quedar vacías y POST que crea el archivo si no existe
export async function startFakeVault(apiKey: string): Promise<FakeVault> {
  const files = new Map<string, Buffer>();
  const requests: FakeVault['requests'] = [];
  const server = https.createServer({ key: TEST_KEY_A, cert: TEST_CERT_A }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const rawPath = (req.url ?? '').startsWith(VAULT_PREFIX) ? (req.url ?? '').slice(VAULT_PREFIX.length) : '';
      const path = decodeURIComponent(rawPath);
      const contentType = String(req.headers['content-type'] ?? '');
      requests.push({ method: req.method ?? '', path, contentType });
      if (req.headers.authorization !== `Bearer ${apiKey}`) return void res.writeHead(HTTP_UNAUTHORIZED).end();
      if (req.method === 'GET' && (path === '' || path.endsWith('/'))) {
        const names = listing(files, path.replace(/\/$/, ''));
        if (!names) return void res.writeHead(HTTP_NOT_FOUND).end('{}');
        return void res.writeHead(HTTP_OK).end(JSON.stringify({ files: names }));
      }
      if (req.method === 'GET') {
        const data = files.get(path);
        return void (data ? res.writeHead(HTTP_OK).end(data) : res.writeHead(HTTP_NOT_FOUND).end('{}'));
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        if (JSON_CONTENT_TYPE.test(contentType)) return void res.writeHead(HTTP_INTERNAL_ERROR).end('{}');
        const current = files.get(path);
        files.set(path, req.method === 'POST' && current ? Buffer.concat([current, body]) : body);
        return void res.writeHead(HTTP_NO_CONTENT).end();
      }
      if (req.method === 'DELETE') {
        return void res.writeHead(files.delete(path) ? HTTP_NO_CONTENT : HTTP_NOT_FOUND).end();
      }
      res.writeHead(HTTP_NOT_FOUND).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    files,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
