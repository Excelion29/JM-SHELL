import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import type * as https from 'https';
import type { AddressInfo } from 'net';
import { checkKbPath, filterSseText, filterToolsResult, KB_ALLOWED_TOOLS, KbProxy, startKbProxy } from './kb-proxy';

const FAKE_KEY = 'test-key-not-real';
const ALL_TOOLS = ['vault_list', 'vault_read', 'vault_delete', 'vault_write', 'command_execute', 'vault_move'];
const SESSION = 'session-abc';
const BASE = 'PROYECTOS/X';
const OVER_BODY_CAP = 10 * 1024 * 1024 + 1;

interface Seen {
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const toolsMessage = (id: number) => ({ jsonrpc: '2.0', id, result: { tools: ALL_TOOLS.map((name) => ({ name })) } });
const names = (message: unknown) =>
  (message as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);

let upstream: http.Server;
let fakeRequest: typeof https.request;
let proxy: KbProxy;
let proxyPort: number;
let proxyPath: string;
let seen: Seen[] = [];
let sseTools = false;
let sseCrlf = false;
let hangTools = false;
let batchTools = false;
let abortGet = false;

function readAll(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function respondToRpc(res: http.ServerResponse, rpc: { id: number; method: string }) {
  const isList = rpc.method === 'tools/list';
  const result = isList ? toolsMessage(rpc.id) : { jsonrpc: '2.0', id: rpc.id, result: { ok: true } };
  if (hangTools && isList) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    return;
  }
  if (batchTools && isList) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([result]));
    return;
  }
  if (sseTools && isList) {
    const eol = sseCrlf ? '\r\n' : '\n';
    res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': SESSION });
    res.end(`event: message${eol}data: ${JSON.stringify(result)}${eol}${eol}`);
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': SESSION });
  res.end(JSON.stringify(result));
}

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const body = await readAll(req);
    seen.push({ method: req.method ?? '', headers: req.headers, body });
    if (req.method === 'GET' && abortGet) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message\ndata: {"partial":');
      setTimeout(() => req.socket.destroy(), 20);
    } else if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('event: message\ndata: {"jsonrpc":"2.0","method":"ping"}\n\n');
    } else if (req.method === 'DELETE') res.writeHead(204).end();
    else respondToRpc(res, JSON.parse(body));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  // Las pruebas no usan TLS: el cliente falso reenvía al servidor HTTP de arriba
  fakeRequest = ((url: URL, options: https.RequestOptions, callback: (res: http.IncomingMessage) => void) =>
    http.request(
      { host: '127.0.0.1', port: upstreamPort, path: url.pathname, method: options.method, headers: options.headers },
      callback,
    )) as unknown as typeof https.request;
  proxy = await startKbProxy({
    upstreamUrl: 'https://kb.example/mcp',
    apiKey: FAKE_KEY,
    baseFolder: BASE,
    request: fakeRequest,
  });
  proxyPort = Number(new URL(proxy.url).port);
  proxyPath = new URL(proxy.url).pathname;
});

after(async () => {
  await proxy.close();
  upstream.close();
  upstream.closeAllConnections();
});

function call(options: {
  method?: string;
  path?: string;
  port?: number;
  headers?: http.OutgoingHttpHeaders;
  body?: unknown;
  raw?: string | Buffer;
}): Promise<Reply> {
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port ?? proxyPort,
        path: options.path ?? proxyPath,
        method: options.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const rpc = (method: string, params?: unknown, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const toolCall = (name: string, args: unknown, id = 9) => rpc('tools/call', { name, arguments: args }, id);
const callOn = (p: KbProxy, body: unknown) =>
  call({ port: Number(new URL(p.url).port), path: new URL(p.url).pathname, body });
const startWith = (filterLimits?: { maxBytes: number; timeoutMs: number }) =>
  startKbProxy({
    upstreamUrl: 'https://kb.example/mcp',
    apiKey: FAKE_KEY,
    baseFolder: BASE,
    request: fakeRequest,
    filterLimits,
  });

test('tools/list en JSON deja pasar solo las herramientas permitidas', async () => {
  seen = [];
  sseTools = false;
  const reply = await call({ body: rpc('tools/list') });
  assert.equal(reply.status, 200);
  assert.deepEqual(names(JSON.parse(reply.body)).sort(), ['vault_list', 'vault_read', 'vault_write']);
});

test('tools/list en SSE también se filtra', async () => {
  sseTools = true;
  const reply = await call({ body: rpc('tools/list') });
  sseTools = false;
  assert.match(String(reply.headers['content-type']), /text\/event-stream/);
  const data = reply.body.split('\n').find((line) => line.startsWith('data: ')) ?? '';
  assert.deepEqual(names(JSON.parse(data.slice('data: '.length))).sort(), ['vault_list', 'vault_read', 'vault_write']);
});

test('una herramienta no permitida se rechaza con error JSON-RPC y nunca llega al servidor', async () => {
  seen = [];
  for (const name of ['vault_delete', 'command_execute', 'vault_move', 'VAULT_LIST', undefined]) {
    const reply = await call({ body: rpc('tools/call', { name, arguments: {} }, 7) });
    const message = JSON.parse(reply.body) as { id: number; error: { code: number; message: string } };
    assert.equal(message.id, 7);
    assert.match(message.error.message, /no está permitida/);
  }
  const notification = await call({ body: { jsonrpc: '2.0', method: 'tools/call', params: { name: 'vault_delete' } } });
  assert.equal(notification.status, 202);
  assert.equal(seen.length, 0);
});

test('una herramienta permitida se reenvía con la key inyectada y sin la autorización del cliente', async () => {
  seen = [];
  const reply = await call({
    headers: { authorization: 'Bearer from-claude', 'mcp-session-id': SESSION, 'mcp-protocol-version': '2025-06-18' },
    body: rpc('tools/call', { name: 'vault_list', arguments: { path: '' } }),
  });
  assert.deepEqual(JSON.parse(reply.body).result, { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(seen[0].headers['mcp-session-id'], SESSION);
  assert.equal(seen[0].headers['mcp-protocol-version'], '2025-06-18');
  assert.equal(reply.headers['mcp-session-id'], SESSION);
});

test('GET (flujo SSE) y DELETE (cerrar sesión) se reenvían', async () => {
  seen = [];
  const stream = await call({ method: 'GET', headers: { accept: 'text/event-stream' } });
  assert.match(stream.body, /"method":"ping"/);
  const closed = await call({ method: 'DELETE', headers: { 'mcp-session-id': SESSION } });
  assert.equal(closed.status, 204);
  assert.deepEqual(
    seen.map((s) => s.method),
    ['GET', 'DELETE'],
  );
  assert.ok(seen.every((s) => s.headers.authorization === `Bearer ${FAKE_KEY}`));
});

test('rechaza Host que no sea el loopback con nuestro puerto, rutas ajenas, métodos raros y lotes', async () => {
  seen = [];
  assert.equal((await call({ headers: { host: 'evil.example' }, body: rpc('tools/list') })).status, 403);
  assert.equal((await call({ headers: { host: '127.0.0.1:1' }, body: rpc('tools/list') })).status, 403);
  assert.equal((await call({ path: '/otra', body: rpc('tools/list') })).status, 404);
  assert.equal((await call({ path: '/mcp', body: rpc('tools/list') })).status, 404);
  assert.equal((await call({ method: 'PUT', body: rpc('tools/list') })).status, 405);
  assert.equal((await call({ body: [rpc('tools/call', { name: 'vault_delete' })] })).status, 400);
  assert.equal(seen.length, 0);
});

test('si el servidor real no responde, el cliente recibe un 502 con el motivo', async () => {
  const failing = await startKbProxy({
    upstreamUrl: 'https://kb.example/mcp',
    apiKey: FAKE_KEY,
    baseFolder: BASE,
    request: (() => http.request({ host: '127.0.0.1', port: 1, path: '/' })) as unknown as typeof https.request,
  });
  const reply = await callOn(failing, rpc('tools/list'));
  await failing.close();
  assert.equal(reply.status, 502);
});

test('el proxy solo acepta un MCP https', async () => {
  await assert.rejects(
    startKbProxy({ upstreamUrl: 'http://kb.example/mcp', apiKey: FAKE_KEY, baseFolder: BASE }),
    /https/,
  );
});

test('filterToolsResult y filterSseText ignoran lo que no es una lista de herramientas', () => {
  assert.deepEqual(filterToolsResult({ result: { ok: true } }), { result: { ok: true } });
  assert.equal(filterToolsResult('texto'), 'texto');
  const ping = ': ping\n\nevent: message\ndata: no-json\n\n';
  assert.equal(filterSseText(ping), ping);
  assert.deepEqual(
    KB_ALLOWED_TOOLS.filter((tool) => /delete|move|copy|execute/.test(tool)),
    [],
  );
});

test('las escrituras solo se reenvían dentro de la carpeta base y sin rutas peligrosas', async () => {
  seen = [];
  const accepted = [
    { name: 'vault_write', path: `${BASE}/00-JM-ADR/AQ-1.md` },
    { name: 'vault_append', path: `${BASE}/otra/nota.md` },
  ];
  for (const { name, path } of accepted) {
    const reply = await call({ body: toolCall(name, { path, content: 'x' }) });
    assert.deepEqual(JSON.parse(reply.body).result, { ok: true }, path);
  }
  assert.equal(seen.length, accepted.length);
  seen = [];
  const rejected = [
    'PROYECTOS/PACASMAYO_MEZCLAS/00-JM-ADR/x.md',
    `${BASE}/../OTRO/x.md`,
    `${BASE}/.obsidian/app.json`,
    `${BASE}/.hidden/x.md`,
    `/${BASE}/x.md`,
    `${BASE}\\x.md`,
    `${BASE}//x.md`,
    `C:/${BASE}/x.md`,
    BASE,
    `${BASE}/`,
    '',
    `${BASE}X/x.md`,
  ];
  for (const path of rejected) {
    const reply = await call({ body: toolCall('vault_write', { path, content: 'x' }) });
    assert.match(JSON.parse(reply.body).error.message, /rechazó la ruta/, path);
  }
  for (const args of [{ content: 'x' }, { path: 5, content: 'x' }, null]) {
    const reply = await call({ body: toolCall('vault_append', args) });
    assert.match(JSON.parse(reply.body).error.message, /rechazó la ruta/);
  }
  assert.equal(seen.length, 0);
});

test('las lecturas validan la forma de la ruta (sin .., absolutas ni ocultas) pero pueden listar la raíz', async () => {
  seen = [];
  for (const path of ['', BASE, `${BASE}/`, 'OTRA/nota.md']) {
    const reply = await call({ body: toolCall('vault_list', { path }) });
    assert.deepEqual(JSON.parse(reply.body).result, { ok: true }, path);
  }
  for (const path of ['../x', '/etc', '.obsidian/app.json', 'a\\b']) {
    for (const name of ['vault_read', 'vault_get_document_map']) {
      const reply = await call({ body: toolCall(name, { path }) });
      assert.match(JSON.parse(reply.body).error.message, /rechazó la ruta/, path);
    }
  }
  assert.equal(seen.length, 4);
});

test('el token de la ruta, Origin y Sec-Fetch-* y el content-type protegen al intermediario', async () => {
  seen = [];
  const wrongToken = `/mcp/${'0'.repeat(32)}`;
  assert.equal((await call({ path: wrongToken, body: rpc('tools/list') })).status, 404);
  assert.equal((await call({ headers: { origin: 'http://evil.example' }, body: rpc('tools/list') })).status, 403);
  assert.equal((await call({ headers: { 'sec-fetch-mode': 'cors' }, body: rpc('tools/list') })).status, 403);
  assert.equal((await call({ headers: { 'content-type': 'text/plain' }, body: rpc('tools/list') })).status, 415);
  const withCharset = { 'content-type': 'application/json; charset=utf-8' };
  assert.equal((await call({ headers: withCharset, body: rpc('ping') })).status, 200);
  assert.match(proxyPath, /^\/mcp\/[0-9a-f]{32}$/);
  assert.equal(seen.length, 1);
});

test('solo pasan los métodos de la lista; el resto recibe -32601 y no llega al servidor', async () => {
  seen = [];
  for (const method of ['resources/list', 'prompts/get', 'sampling/createMessage', 'logging/setLevel']) {
    const reply = await call({ body: rpc(method) });
    assert.equal(JSON.parse(reply.body).error.code, -32601, method);
  }
  assert.equal(seen.length, 0);
  for (const method of ['initialize', 'notifications/initialized', 'notifications/cancelled', 'ping']) {
    assert.equal((await call({ body: rpc(method) })).status, 200, method);
  }
  assert.equal(seen.length, 4);
});

test('se reenvía el JSON ya parseado: una clave duplicada no puede esconder otra herramienta', async () => {
  seen = [];
  const raw =
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"vault_delete","name":"vault_list","arguments":{"path":""}}}';
  const reply = await call({ raw });
  assert.deepEqual(JSON.parse(reply.body).result, { ok: true });
  assert.equal(seen[0].body, JSON.stringify(JSON.parse(raw)));
  assert.ok(!seen[0].body.includes('vault_delete'));
});

test('tools/list en SSE con CRLF o CR también se filtra', async () => {
  for (const eol of ['\r\n', '\r']) {
    const text = `event: message${eol}data: ${JSON.stringify(toolsMessage(1))}${eol}${eol}`;
    assert.ok(!filterSseText(text).includes('vault_delete'), JSON.stringify(eol));
  }
  sseTools = true;
  sseCrlf = true;
  const reply = await call({ body: rpc('tools/list') });
  sseTools = false;
  sseCrlf = false;
  assert.ok(!reply.body.includes('vault_delete'));
  assert.ok(reply.body.includes('vault_list'));
});

test('una respuesta en lote, demasiado grande o que se cuelga da 502 en vez de pasar sin filtrar', async () => {
  assert.throws(() => filterToolsResult([toolsMessage(1)]), /lote/);
  assert.throws(() => filterSseText(`data: ${JSON.stringify([toolsMessage(1)])}\n\n`), /lote/);
  batchTools = true;
  const batch = await call({ body: rpc('tools/list') });
  batchTools = false;
  assert.equal(batch.status, 502);

  const tiny = await startWith({ maxBytes: 10, timeoutMs: 5000 });
  const big = await callOn(tiny, rpc('tools/list'));
  await tiny.close();
  assert.equal(big.status, 502);
  assert.match(big.body, /demasiado grande/);

  const slow = await startWith({ maxBytes: 1024, timeoutMs: 100 });
  hangTools = true;
  const late = await callOn(slow, rpc('tools/list'));
  hangTools = false;
  await slow.close();
  assert.equal(late.status, 502);
  assert.match(late.body, /demasiado/);
});

test('si el servidor aborta un flujo a medias, la conexión del cliente se destruye', async () => {
  abortGet = true;
  const outcome = await new Promise<string>((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: proxyPort, path: proxyPath, method: 'GET', headers: { accept: 'text/event-stream' } },
      (res) => {
        res.resume();
        res.on('close', () => resolve(res.complete ? 'complete' : 'aborted'));
      },
    );
    req.on('error', () => resolve('aborted'));
    req.end();
  });
  abortGet = false;
  assert.equal(outcome, 'aborted');
});

test('un cuerpo por encima del tope se corta (413 o conexión cerrada) y no llega al servidor', async () => {
  seen = [];
  const outcome = await call({ raw: Buffer.alloc(OVER_BODY_CAP, 'a') }).then(
    (reply) => reply.status,
    (err: NodeJS.ErrnoException) => err.code ?? 'error',
  );
  assert.ok(outcome === 413 || typeof outcome === 'string', String(outcome));
  assert.equal(seen.length, 0);
});

test('checkKbPath: sin base cualquier ruta relativa válida cabe; con base solo su interior', () => {
  assert.equal(checkKbPath('a/b.md', '', true), null);
  assert.notEqual(checkKbPath('', '', true), null);
  assert.equal(checkKbPath('P/x/n.md', 'P/x', true), null);
  assert.notEqual(checkKbPath('P/y/n.md', 'P/x', true), null);
  assert.equal(checkKbPath('', 'P/x', false), null);
});

test('checkKbPath rechaza %, puntos Unicode parecidos y deja pasar tildes y espacios', () => {
  for (const bad of ['P/x/%2e%2e/y.md', 'P/x/%2E/y.md', 'P/x/．．/y.md', 'P/x/․․/y.md', 'P/x/ﬁ.md'])
    assert.notEqual(checkKbPath(bad, 'P/x', true), null, bad);
  assert.equal(checkKbPath('P/x/Decisión de arquitectura ñandú.md', 'P/x', true), null);
});

test('solo se reenvían los argumentos permitidos de cada herramienta (-32602 si sobra alguno)', async () => {
  seen = [];
  const accepted: Array<[string, unknown]> = [
    ['vault_write', { path: `${BASE}/n.md`, content: 'x' }],
    ['search_simple', { query: 'adr' }],
    ['tag_list', {}],
    ['vault_list', {}],
    ['vault_read', { path: `${BASE}/n.md`, targetType: 'heading', target: 'Decisiones' }],
    ['vault_append', { path: `${BASE}/n.md`, content: 'x', ifMatch: 'etag' }],
    ['search_simple', { query: 'adr', contextLength: 80, maxResults: 5 }],
  ];
  for (const [name, args] of accepted) {
    assert.deepEqual(JSON.parse((await call({ body: toolCall(name, args) })).body).result, { ok: true }, name);
  }
  assert.equal(seen.length, accepted.length);
  seen = [];
  const rejected: Array<[string, unknown]> = [
    ['vault_read', { path: `${BASE}/n.md`, mode: 'raw' }],
    ['vault_write', { path: `${BASE}/n.md`, content: 'x', overwrite: true }],
    ['search_query', { query: 'x', vault: 'otra' }],
    ['tag_list', { path: '' }],
  ];
  for (const [name, args] of rejected) {
    const error = JSON.parse((await call({ body: toolCall(name, args) })).body).error;
    assert.equal(error.code, -32602, name);
  }
  assert.equal(seen.length, 0);
});
