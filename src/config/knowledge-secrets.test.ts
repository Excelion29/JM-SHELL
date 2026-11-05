import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { TEST_CERT_A, TEST_CERT_B } from '../refinement/test-certs';
import { loadKnowledgeCert, loadKnowledgeKey, saveKnowledgeCert, saveKnowledgeKey } from './knowledge-secrets';

const URL_A = 'https://127.0.0.1:27124/mcp';
const URL_B = 'https://otro.host:8443/mcp';
const FAKE_KEY = 'fake-key-for-tests';
const PIN = '1234';

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'jm-secrets-'));

test('la key se guarda cifrada por host:puerto y se recupera con el PIN', async () => {
  const dir = await tempDir();
  await saveKnowledgeKey(URL_A, FAKE_KEY, PIN, dir);
  await saveKnowledgeKey(URL_B, 'otra-key', PIN, dir);
  const raw = await fs.readFile(path.join(dir, 'knowledge-keys.json'), 'utf8');
  assert.ok(!raw.includes(FAKE_KEY));
  assert.equal(await loadKnowledgeKey(URL_A, PIN, dir), FAKE_KEY);
  assert.equal(await loadKnowledgeKey(URL_B, PIN, dir), 'otra-key');
  assert.equal(await loadKnowledgeKey('https://sin-key:1/mcp', PIN, dir), null);
  await assert.rejects(loadKnowledgeKey(URL_A, '9999', dir), /PIN incorrecto/);
});

test('el certificado se guarda en kb-certs/<host_puerto>.crt', async () => {
  const dir = await tempDir();
  assert.equal(await loadKnowledgeCert(URL_A, dir), null);
  await saveKnowledgeCert(URL_A, TEST_CERT_A, dir);
  assert.equal(await fs.readFile(path.join(dir, 'kb-certs', '127.0.0.1_27124.crt'), 'utf8'), TEST_CERT_A);
  assert.equal(await loadKnowledgeCert(URL_A, dir), TEST_CERT_A);
});

test('un paquete con más de un certificado no se guarda ni se carga', async () => {
  const dir = await tempDir();
  await assert.rejects(saveKnowledgeCert(URL_A, `${TEST_CERT_A}${TEST_CERT_B}`, dir), /exactamente uno/);
  await fs.ensureDir(path.join(dir, 'kb-certs'));
  await fs.writeFile(path.join(dir, 'kb-certs', '127.0.0.1_27124.crt'), `${TEST_CERT_A}${TEST_CERT_B}`);
  await assert.rejects(loadKnowledgeCert(URL_A, dir), /exactamente uno/);
});
