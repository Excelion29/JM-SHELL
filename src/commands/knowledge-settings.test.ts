import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { loadKnowledgeCert, loadKnowledgeKey, saveKnowledgeCert, saveKnowledgeKey } from '../config/knowledge-secrets';
import { isKnowledgeTrusted, trustKnowledge } from '../config/knowledge-trust';
import { TEST_CERT_A } from '../refinement/test-certs';
import { clearSession, setSessionPin } from '../utils/session';
import { changeKnowledge, knowledgeSettings, renewKnowledgeKey, resolveTarget } from './knowledge-setup';
import { readKnowledgeConfig } from './knowledge-runtime';
import { ensureStory } from '../refinement/state';
import { closeStoryStores, listAllStories, openStory } from './story-resolver';

const PIN = '1234';
const OLD_KEY = 'old-key-for-tests';
const NEW_KEY = 'new-key-for-tests';
const MCP_URL = 'https://127.0.0.1:27124/mcp';
const NO_VERIFY = async () => undefined;

const tempDir = (prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

async function projectWith(knowledge: unknown): Promise<string> {
  const root = await tempDir('jm-set-root-');
  await fs.writeJson(path.join(root, '.jira.json'), { projectKey: 'AQ', defaultAssignee: 'x', knowledge });
  return root;
}

async function kbWithStories(count: number): Promise<string> {
  const kb = await tempDir('jm-set-kb-');
  for (let i = 1; i <= count; i += 1) await fs.ensureDir(path.join(kb, 'PROY', '00-JM-ADR', `AQ-${i}`));
  await fs.ensureDir(path.join(kb, 'OTRA'));
  await fs.ensureDir(path.join(kb, 'PROY'));
  return kb;
}

const readConfig = async (root: string) => fs.readJson(path.join(root, '.jira.json'));

async function trustedProject(knowledge: Parameters<typeof trustKnowledge>[1], secrets: string): Promise<string> {
  const root = await projectWith(knowledge);
  await trustKnowledge(root, knowledge, secrets);
  return root;
}

test('la pantalla muestra la configuración actual: tipo, destino, carpeta base, JM-ADR y conexión', async () => {
  const kb = await kbWithStories(1);
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  assert.deepEqual(await knowledgeSettings(root), {
    type: 'local',
    target: kb,
    baseFolder: 'PROY',
    adrFolder: '00-JM-ADR',
    connection: 'ok',
    connectionError: null,
  });
  const missing = await projectWith({ type: 'local', root: path.join(kb, 'no-existe'), baseFolder: 'PROY' });
  const unreachable = await knowledgeSettings(missing);
  assert.equal(unreachable.connection, 'unreachable');
  assert.equal(unreachable.adrFolder, null);
  assert.equal((await knowledgeSettings(await projectWith({ type: 'none' }))).connection, 'none');
});

test('cambiar la carpeta base guarda, confía y cuenta las historias que quedan en la ubicación anterior', async () => {
  const kb = await kbWithStories(2);
  const secrets = await tempDir('jm-set-secrets-');
  const root = await trustedProject({ type: 'local', root: kb, baseFolder: 'PROY' }, secrets);
  const choice = { type: 'connect', connection: { type: 'current' }, baseFolder: 'OTRA' } as const;
  const result = await changeKnowledge(root, choice, secrets);
  assert.deepEqual(result, { leftBehind: 2, movesOnOpen: false });
  const config = await readKnowledgeConfig(root);
  assert.deepEqual(config, { type: 'local', root: kb, baseFolder: 'OTRA' });
  assert.ok(config && (await isKnowledgeTrusted(root, config, secrets)));
  assert.equal(await fs.pathExists(path.join(kb, 'PROY', '00-JM-ADR', 'AQ-1')), true);
});

test('quitar la base escribe none y avisa de las historias que siguen en la base anterior', async () => {
  const kb = await kbWithStories(3);
  const secrets = await tempDir('jm-set-secrets-');
  const root = await trustedProject({ type: 'local', root: kb, baseFolder: 'PROY' }, secrets);
  assert.deepEqual(await changeKnowledge(root, { type: 'none' }, secrets), { leftBehind: 3, movesOnOpen: false });
  assert.deepEqual((await readConfig(root)).knowledge, { type: 'none' });
});

test('sin base previa, las historias que quedan atrás son las de .jm', async () => {
  const kb = await kbWithStories(0);
  const root = await projectWith({ type: 'none' });
  await fs.ensureDir(path.join(root, '.jm', 'historias', 'AQ-7'));
  const secrets = await tempDir('jm-set-secrets-');
  const result = await changeKnowledge(
    root,
    { type: 'connect', connection: { type: 'local', root: kb }, baseFolder: 'PROY' },
    secrets,
  );
  assert.deepEqual(result, { leftBehind: 1, movesOnOpen: true });
});

test('si el cambio falla no se guarda nada ni se toca la configuración anterior', async () => {
  const kb = await kbWithStories(1);
  const knowledge = { type: 'local', root: kb, baseFolder: 'PROY' };
  const root = await projectWith(knowledge);
  await assert.rejects(
    changeKnowledge(root, { type: 'connect', connection: { type: 'current' }, baseFolder: '../fuera' }),
    /no es válida/,
  );
  await assert.rejects(
    changeKnowledge(root, { type: 'connect', connection: { type: 'current' }, baseFolder: '' }),
    /no la raíz/,
  );
  assert.deepEqual((await readConfig(root)).knowledge, knowledge);
});

test('un cambio invalida el listado en caché para usar la configuración nueva de inmediato', async () => {
  const kb = await kbWithStories(2);
  const secrets = await tempDir('jm-set-secrets-');
  const root = await trustedProject({ type: 'local', root: kb, baseFolder: 'PROY' }, secrets);
  for (let i = 1; i <= 2; i += 1) {
    const { store } = await openStory(root, `AQ-${i}`, { secretsDir: secrets });
    await ensureStory(store, `AQ-${i}`, 'Login', null);
  }
  const cached = await listAllStories(root, { secretsDir: secrets });
  assert.equal(cached.length, 2);
  await changeKnowledge(root, { type: 'none' }, secrets);
  assert.deepEqual(await listAllStories(root, { secretsDir: secrets }), []);
  closeStoryStores();
});

test('resolveTarget "current" entrega la conexión guardada sin que la key salga del almacén cifrado', async () => {
  const secrets = await tempDir('jm-set-secrets-');
  setSessionPin(PIN);
  try {
    await saveKnowledgeKey(MCP_URL, OLD_KEY, PIN, secrets);
    await saveKnowledgeCert(MCP_URL, TEST_CERT_A, secrets);
    const root = await projectWith({ type: 'mcp', url: MCP_URL, baseFolder: 'PROY', tls: 'pinned' });
    assert.deepEqual(await resolveTarget(root, { type: 'current' }, secrets), {
      type: 'mcp',
      url: MCP_URL,
      apiKey: OLD_KEY,
      certPem: TEST_CERT_A,
    });
    assert.ok(!JSON.stringify(await readConfig(root)).includes(OLD_KEY));
  } finally {
    clearSession();
  }
});

test('renovar la API key verifica con el servidor, re-cifra y conserva configuración y confianza', async () => {
  const secrets = await tempDir('jm-set-secrets-');
  setSessionPin(PIN);
  try {
    await saveKnowledgeKey(MCP_URL, OLD_KEY, PIN, secrets);
    await saveKnowledgeCert(MCP_URL, TEST_CERT_A, secrets);
    const knowledge = { type: 'mcp' as const, url: MCP_URL, baseFolder: 'PROY', tls: 'pinned' as const };
    const root = await projectWith(knowledge);
    await trustKnowledge(root, knowledge, secrets);
    const verified: Array<{ url: string; apiKey: string; ca?: string }> = [];
    await renewKnowledgeKey(root, NEW_KEY, secrets, async (endpoint) => void verified.push(endpoint));
    assert.deepEqual(verified, [{ url: MCP_URL, apiKey: NEW_KEY, ca: TEST_CERT_A }]);
    assert.equal(await loadKnowledgeKey(MCP_URL, PIN, secrets), NEW_KEY);
    assert.equal(await loadKnowledgeCert(MCP_URL, secrets), TEST_CERT_A);
    assert.deepEqual((await readConfig(root)).knowledge, knowledge);
    assert.ok(await isKnowledgeTrusted(root, knowledge, secrets));
  } finally {
    clearSession();
  }
});

test('si la nueva API key no se verifica, la anterior sigue guardada; sin PIN o sin MCP tampoco renueva', async () => {
  const secrets = await tempDir('jm-set-secrets-');
  setSessionPin(PIN);
  try {
    await saveKnowledgeKey(MCP_URL, OLD_KEY, PIN, secrets);
    const root = await projectWith({ type: 'mcp', url: MCP_URL, baseFolder: 'PROY', tls: 'system' });
    await assert.rejects(
      renewKnowledgeKey(root, NEW_KEY, secrets, async () => {
        throw new Error('401');
      }),
      /401/,
    );
    assert.equal(await loadKnowledgeKey(MCP_URL, PIN, secrets), OLD_KEY);
    await assert.rejects(
      renewKnowledgeKey(await projectWith({ type: 'none' }), NEW_KEY, secrets, NO_VERIFY),
      /no usa una base MCP/,
    );
    clearSession();
    await assert.rejects(renewKnowledgeKey(root, NEW_KEY, secrets, NO_VERIFY), /PIN/);
  } finally {
    clearSession();
  }
});
