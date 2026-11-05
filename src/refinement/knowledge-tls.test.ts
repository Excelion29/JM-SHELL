import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as https from 'https';
import * as net from 'net';
import type { AddressInfo } from 'net';
import { createRestClient, inspectServerTls } from './knowledge-rest';
import { assertSingleCertificate, createKnowledgeAgent, fingerprintOf, pinnedIdentityCheck } from './knowledge-tls';
import { TEST_CERT_A, TEST_CERT_B, TEST_KEY_A } from './test-certs';

const FAKE_KEY = 'test-key-not-real';
const HANDSHAKE_TEST_TIMEOUT_MS = 200;
let server: https.Server;
let origin: string;
const requests: string[] = [];

before(async () => {
  server = https.createServer({ key: TEST_KEY_A, cert: TEST_CERT_A }, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith('/vault/NOTA')) res.end('0123456789'.repeat(2000));
    else res.end(JSON.stringify({ files: ['Carpeta/', 'nota.md'] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

test('la huella que se muestra es la del certificado que el servidor presenta en el handshake', async () => {
  const inspection = await inspectServerTls(`${origin}/mcp`);
  assert.equal(inspection.tls, 'untrusted');
  assert.ok(inspection.tls === 'untrusted' && inspection.fingerprint === fingerprintOf(TEST_CERT_A));
  assert.ok(inspection.tls === 'untrusted' && fingerprintOf(inspection.pem) === fingerprintOf(TEST_CERT_A));
});

test('con el certificado fijado la conexión se acepta y se leen carpetas', async () => {
  const client = createRestClient({ origin, apiKey: FAKE_KEY, ca: TEST_CERT_A });
  assert.deepEqual(await client.listDir('PROY'), [
    { name: 'Carpeta', isFolder: true },
    { name: 'nota.md', isFolder: false },
  ]);
  client.close();
});

test('un certificado distinto del fijado se rechaza y la key no llega a salir', async () => {
  requests.length = 0;
  const client = createRestClient({ origin, apiKey: FAKE_KEY, ca: TEST_CERT_B });
  await assert.rejects(client.listDir('PROY'), /no es el que confiaste/);
  client.close();
  assert.equal(requests.length, 0);
});

test('sin certificado fijado un servidor autofirmado se rechaza (autoridades del sistema)', async () => {
  const client = createRestClient({ origin, apiKey: FAKE_KEY });
  await assert.rejects(client.listDir('PROY'), (err: NodeJS.ErrnoException) =>
    /SELF_SIGNED|UNABLE_TO/.test(err.code ?? ''),
  );
  client.close();
});

test('la verificación de identidad exige la huella exacta, sin mirar el host', () => {
  const check = pinnedIdentityCheck(TEST_CERT_A);
  const fingerprint256 = fingerprintOf(TEST_CERT_A);
  assert.equal(check({ fingerprint256 } as never), undefined);
  assert.ok(check({ fingerprint256: fingerprintOf(TEST_CERT_B) } as never) instanceof Error);
  assert.equal(createKnowledgeAgent(TEST_CERT_A).options.rejectUnauthorized, undefined);
  assert.equal(createKnowledgeAgent().options.keepAlive, true);
});

test('un paquete con más de un certificado (o ninguno) se rechaza', () => {
  assert.doesNotThrow(() => assertSingleCertificate(TEST_CERT_A));
  assert.throws(() => assertSingleCertificate(`${TEST_CERT_A}${TEST_CERT_B}`), /exactamente uno/);
  assert.throws(() => assertSingleCertificate('no es un certificado'), /exactamente uno/);
  assert.throws(() => createKnowledgeAgent(`${TEST_CERT_A}${TEST_CERT_B}`), /exactamente uno/);
});

test('readFile con tope devuelve solo el principio y la descarga se corta', async () => {
  const client = createRestClient({ origin, apiKey: FAKE_KEY, ca: TEST_CERT_A });
  const head = await client.readFile('NOTA.md', 100);
  const full = await client.readFile('NOTA.md');
  client.close();
  assert.equal(head, '0123456789'.repeat(10));
  assert.equal(full?.length, 20000);
});

test('un servidor que nunca completa el handshake falla por tiempo y no cuelga la conexión', async () => {
  const sockets: net.Socket[] = [];
  const silent = net.createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const port = (silent.address() as AddressInfo).port;
  const agent = createKnowledgeAgent(TEST_CERT_A, HANDSHAKE_TEST_TIMEOUT_MS);
  const outcome = await new Promise<string>((resolve) => {
    const req = https.request({ host: '127.0.0.1', port, agent }, () => resolve('responded'));
    req.on('error', (err) => resolve(err.message));
    req.end();
  });
  agent.destroy();
  silent.close();
  sockets.forEach((socket) => socket.destroy());
  assert.match(outcome, /no completó la conexión segura/);
});
