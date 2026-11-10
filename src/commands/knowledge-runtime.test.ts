import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as https from 'https';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { saveKnowledgeCert, saveKnowledgeKey } from '../config/knowledge-secrets';
import { trustKnowledge } from '../config/knowledge-trust';
import { TEST_CERT_A, TEST_KEY_A } from '../refinement/test-certs';
import { parseKnowledgeConfig } from '../refinement/knowledge';
import { clearSession, setSessionPin } from '../utils/session';
import { openKnowledge } from './knowledge-runtime';

const PIN = '1234';
const FAKE_KEY = 'fake-key-for-tests';

const tempDir = (prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

// Todas las pruebas usan una carpeta de secretos propia: nunca el ~/.jira-tool real
let secrets: string;
before(async () => {
  secrets = await tempDir('jm-rt-secrets-');
});

async function rootWith(knowledge: unknown, trusted = true) {
  const root = await tempDir('jm-rt-root-');
  await fs.writeJson(path.join(root, '.jira.json'), { projectKey: 'AQ', defaultAssignee: 'x', knowledge });
  const config = parseKnowledgeConfig(knowledge);
  if (trusted && config) await trustKnowledge(root, config, secrets);
  return root;
}

const open = (root: string, hasSession = false, hasLocalLog = false) =>
  openKnowledge({ root, key: 'AQ-45', hasSession, hasLocalLog, secretsDir: secrets });

test('sin base o con "ninguna": no hay herramientas ni contexto', async () => {
  for (const knowledge of [undefined, { type: 'none' }]) {
    const root = await rootWith(knowledge);
    const runtime = await open(root);
    assert.equal(runtime.kb, null);
    assert.equal(runtime.context, null);
    assert.equal(runtime.proxyUrl, null);
    assert.equal(runtime.startMessage, 'first');
  }
});

test('carpeta local: crea la JM-ADR numerada, da el permiso acotado y retoma desde la nota', async () => {
  const kb = await tempDir('jm-rt-kb-');
  await fs.ensureDir(path.join(kb, 'PROY', '01-Docs'));
  await fs.ensureDir(path.join(kb, 'PROY', '03-Otro'));
  const root = await rootWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  const first = await open(root);
  assert.ok(await fs.pathExists(path.join(kb, 'PROY', '04-JM-ADR')));
  assert.equal(first.kb?.type, 'local');
  assert.ok(
    first.kb?.type === 'local' && first.kb.adrDir.endsWith('/PROY/04-JM-ADR') && !first.kb.adrDir.includes('\\'),
  );
  assert.match(first.context ?? '', /04-JM-ADR\/AQ-45\.md/);
  assert.equal(first.startMessage, 'first');

  await fs.writeFile(path.join(kb, 'PROY', '04-JM-ADR', 'AQ-45.md'), '# decisiones');
  assert.equal((await open(root)).startMessage, 'fromNote');
  assert.equal((await open(root, true)).startMessage, 'resume');
});

test('carpeta local con la raíz de la bóveda como base: lista la raíz y el permiso de escritura queda en JM-ADR', async () => {
  const kb = await tempDir('jm-rt-rootbase-');
  await fs.ensureDir(path.join(kb, '01-Docs'));
  const root = await rootWith({ type: 'local', root: kb, baseFolder: '' });
  const runtime = await open(root);
  assert.ok(await fs.pathExists(path.join(kb, '02-JM-ADR')));
  assert.ok(runtime.kb?.type === 'local' && runtime.kb.adrDir.endsWith('/02-JM-ADR'));
  assert.match(runtime.context ?? '', /02-JM-ADR\/AQ-45\.md/);
});

test('si la base no responde, abrir falla con un mensaje claro (el chat se bloquea)', async () => {
  const missing = path.join(await tempDir('jm-rt-gone-'), 'no-existe');
  const root = await rootWith({ type: 'local', root: missing, baseFolder: 'PROY' });
  await assert.rejects(open(root), /No pude conectar con la base de conocimiento/);
});

test('MCP sin PIN en memoria o sin key guardada: error claro y sin abrir el intermediario', async () => {
  clearSession();
  const root = await rootWith({ type: 'mcp', url: 'https://127.0.0.1:1/mcp', baseFolder: 'PROY', tls: 'system' });
  await assert.rejects(open(root), /No encuentro la API key/);
});

test('un campo knowledge inválido bloquea con instrucciones', async () => {
  const root = await rootWith({ type: 'mcp', url: 'http://sin-tls/mcp', baseFolder: 'PROY', tls: 'system' });
  await assert.rejects(open(root), /no es válido/);
});

test('una carpeta local con caracteres que cmd interpreta se rechaza antes de lanzar Claude', async () => {
  const root = await rootWith({ type: 'local', root: 'C:\\notas & calc', baseFolder: 'PROY' });
  await assert.rejects(open(root), /no admite/);
});

test('una base del .jira.json que el dev no confirmó no se abre', async () => {
  const kb = await tempDir('jm-rt-untrusted-');
  const root = await rootWith({ type: 'local', root: kb, baseFolder: 'PROY' }, false);
  await assert.rejects(open(root), /aún no está confirmada/);
  assert.ok(!(await fs.pathExists(path.join(kb, '00-JM-ADR'))));
});

test('abrir una base cuyo .jira.json cambió tras confirmarla vuelve a exigir confirmación', async () => {
  const kb = await tempDir('jm-rt-changed-');
  await fs.ensureDir(path.join(kb, 'PROY'));
  const root = await rootWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  await open(root);
  const other = await tempDir('jm-rt-changed-b-');
  await fs.writeJson(path.join(root, '.jira.json'), {
    projectKey: 'AQ',
    knowledge: { type: 'local', root: other, baseFolder: 'PROY' },
  });
  await assert.rejects(open(root), /aún no está confirmada/);
});

let server: https.Server;
let serverUrl: string;
const requests: string[] = [];
let initializeOk = true;

const NOTE = 'AQ-45.md';
const LISTINGS: Record<string, string[]> = {
  '/vault/PROY/': ['01-Docs/', '00-JM-ADR/'],
  '/vault/PROY/00-JM-ADR/': [NOTE],
};

before(async () => {
  server = https.createServer({ key: TEST_KEY_A, cert: TEST_CERT_A }, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'POST') {
      if (initializeOk && req.url === '/mcp') res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      else res.writeHead(404).end();
      return;
    }
    const files = req.method === 'GET' ? LISTINGS[req.url ?? ''] : undefined;
    if (files) res.end(JSON.stringify({ files }));
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

test('MCP: con un certificado fijado para el host se usa aunque el .jira.json diga "system"; la nota se detecta por el listado', async () => {
  setSessionPin(PIN);
  try {
    await saveKnowledgeKey(serverUrl, FAKE_KEY, PIN, secrets);
    await saveKnowledgeCert(serverUrl, TEST_CERT_A, secrets);
    const root = await rootWith({ type: 'mcp', url: serverUrl, baseFolder: 'PROY', tls: 'system' });
    requests.length = 0;
    const runtime = await open(root);
    try {
      assert.equal(runtime.startMessage, 'fromNote');
      assert.match(runtime.proxyUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{32}$/);
      assert.ok(!requests.some((url) => url.endsWith(NOTE)), 'no se descarga el cuerpo de la nota');
    } finally {
      await runtime.close();
    }
  } finally {
    clearSession();
  }
});

test('MCP: sin certificado fijado, un servidor autofirmado no se acepta y no queda intermediario abierto', async () => {
  setSessionPin(PIN);
  const otherSecrets = await tempDir('jm-rt-nopin-');
  try {
    await saveKnowledgeKey(serverUrl, FAKE_KEY, PIN, otherSecrets);
    const root = await rootWith({ type: 'mcp', url: serverUrl, baseFolder: 'PROY', tls: 'system' });
    await trustKnowledge(root, { type: 'mcp', url: serverUrl, baseFolder: 'PROY', tls: 'system' }, otherSecrets);
    await assert.rejects(
      openKnowledge({ root, key: 'AQ-45', hasSession: false, hasLocalLog: false, secretsDir: otherSecrets }),
      /No pude conectar con la base de conocimiento/,
    );
  } finally {
    clearSession();
  }
});

test('MCP: una URL guardada sin ruta (solo el origen) se cura a /mcp sin pedir confirmar de nuevo', async () => {
  setSessionPin(PIN);
  try {
    const bare = serverUrl.replace(/\/mcp$/, '/');
    await saveKnowledgeKey(bare, FAKE_KEY, PIN, secrets);
    await saveKnowledgeCert(bare, TEST_CERT_A, secrets);
    const root = await rootWith({ type: 'mcp', url: bare, baseFolder: 'PROY', tls: 'pinned' });
    requests.length = 0;
    const runtime = await open(root);
    await runtime.close();
    assert.ok(requests.includes('POST /mcp'), 'el initialize va a /mcp, no a /');
    assert.ok(!requests.includes('POST /'));
  } finally {
    clearSession();
  }
});

test('MCP: si el endpoint no responde initialize, abrir se bloquea con un mensaje claro', async () => {
  setSessionPin(PIN);
  initializeOk = false;
  try {
    await saveKnowledgeKey(serverUrl, FAKE_KEY, PIN, secrets);
    await saveKnowledgeCert(serverUrl, TEST_CERT_A, secrets);
    const root = await rootWith({ type: 'mcp', url: serverUrl, baseFolder: 'PROY', tls: 'pinned' });
    await assert.rejects(open(root), /No pude conectar con la base de conocimiento.*no responde como MCP/);
  } finally {
    initializeOk = true;
    clearSession();
  }
});
