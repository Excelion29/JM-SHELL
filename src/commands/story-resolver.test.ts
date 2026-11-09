import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { saveKnowledgeCert, saveKnowledgeKey } from '../config/knowledge-secrets';
import { trustKnowledge } from '../config/knowledge-trust';
import { FakeVault, startFakeVault } from '../refinement/fake-vault';
import { parseKnowledgeConfig } from '../refinement/knowledge';
import { legacyStoryDir } from '../refinement/migrate';
import { ensureStory, readState, updateState } from '../refinement/state';
import { TEST_CERT_A } from '../refinement/test-certs';
import { clearSession, setSessionPin } from '../utils/session';
import { refreshDashboard } from './dashboard';
import { createAnalysis, readAnalysis } from '../refinement/analysis';
import {
  closeStoryStores,
  invalidateAnalysisListing,
  listAllAnalyses,
  listAllStories,
  listAnalysisIds,
  openAnalysis,
  openStory,
  PENDING_MOVE_SUFFIX,
} from './story-resolver';

const PIN = '1234';
const API_KEY = 'fake-key-for-resolver-tests';
const KEY = 'AQ-45';

let vault: FakeVault;
let secrets: string;
let mcpUrl: string;

before(async () => {
  vault = await startFakeVault(API_KEY);
  secrets = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-res-secrets-'));
  mcpUrl = `${vault.origin}/mcp`;
  await saveKnowledgeKey(mcpUrl, API_KEY, PIN, secrets);
  await saveKnowledgeCert(mcpUrl, TEST_CERT_A, secrets);
});
after(() => vault.close());
afterEach(() => {
  closeStoryStores();
  clearSession();
  vault.files.clear();
});

async function projectWith(knowledge: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-res-root-'));
  await fs.writeJson(path.join(root, '.jira.json'), { projectKey: 'AQ', defaultAssignee: 'x', knowledge });
  const config = parseKnowledgeConfig(knowledge);
  if (config) await trustKnowledge(root, config, secrets);
  return root;
}

const mcpConfig = () => ({ type: 'mcp', url: mcpUrl, baseFolder: 'PROY', tls: 'pinned' });
const seedVaultBase = () => vault.files.set('PROY/01-Docs/a.md', Buffer.from('# a'));

async function localKb(): Promise<string> {
  const kb = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-res-kb-'));
  await fs.ensureDir(path.join(kb, 'PROY', '01-Docs'));
  return kb;
}

test('con base local la historia y el índice quedan en la base y el repositorio no recibe .jm', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  const { store } = await openStory(root, KEY, { secretsDir: secrets });
  await ensureStory(store, KEY, 'Login', null);
  await store.writeText('plan.json', '{}');
  const adr = path.join(kb, 'PROY', '02-JM-ADR');
  for (const file of ['estado.json', 'bitacora.md', 'plan.json']) {
    assert.ok(await fs.pathExists(path.join(adr, KEY, file)), file);
  }
  assert.match(await fs.readFile(path.join(adr, '00-indice.md'), 'utf8'), /\[\[AQ-45\]\] \| Login/);
  assert.ok(!(await fs.pathExists(path.join(root, '.jm'))));
  assert.equal(store.kind, 'local');
});

test('con MCP la historia, los adjuntos y el índice quedan en la bóveda y el repositorio no recibe .jm', async () => {
  setSessionPin(PIN);
  seedVaultBase();
  const root = await projectWith(mcpConfig());
  const { store } = await openStory(root, KEY, { secretsDir: secrets });
  await ensureStory(store, KEY, 'Login', null);
  await store.writeBinary('adjuntos/1-a.png', Buffer.from([0xff, 0x00, 0x89]));
  const dir = 'PROY/02-JM-ADR';
  for (const file of ['estado.json', 'bitacora.md']) assert.ok(vault.files.has(`${dir}/${KEY}/${file}`), file);
  assert.ok(vault.files.has(`${dir}/${KEY}/adjuntos/1-a.png`));
  assert.match(vault.files.get(`${dir}/00-indice.md`)?.toString() ?? '', /\[\[AQ-45\]\]/);
  assert.ok(!(await fs.pathExists(path.join(root, '.jm'))));
  assert.equal(store.kind, 'vault');
  assert.equal((await readState(store, KEY))?.summary, 'Login');
});

test('sin base la historia vive en .jm del proyecto y se ignora en git sin tocar el .gitignore', async () => {
  const root = await projectWith(undefined);
  await fs.ensureDir(path.join(root, '.git', 'objects'));
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await fs.writeFile(path.join(root, '.gitignore'), 'dist\n');
  const { store } = await openStory(root, KEY, { secretsDir: secrets });
  await ensureStory(store, KEY, 'Login', null);
  assert.equal(store.kind, 'project');
  assert.ok(await fs.pathExists(path.join(legacyStoryDir(root, KEY), 'estado.json')));
  assert.match(await fs.readFile(path.join(root, '.git', 'info', 'exclude'), 'utf8'), /^\/\.jm\/$/m);
  assert.equal(await fs.readFile(path.join(root, '.gitignore'), 'utf8'), 'dist\n');
});

test('al abrir una historia con base conectada, lo que había en .jm se mueve a la base', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  await fs.outputFile(path.join(legacyStoryDir(root, KEY), 'estado.json'), '{"summary":"Vieja"}\n');
  await fs.outputFile(path.join(legacyStoryDir(root, KEY), 'adjuntos', '1-a.png'), Buffer.from([1, 2, 255]));
  const { store, notice } = await openStory(root, KEY, { secretsDir: secrets });
  assert.equal(notice, undefined);
  assert.equal((await readState(store, KEY))?.summary, 'Vieja');
  assert.ok(await fs.pathExists(path.join(kb, 'PROY', '02-JM-ADR', KEY, 'adjuntos', '1-a.png')));
  assert.ok(!(await fs.pathExists(path.join(root, '.jm'))));
});

test('la misma historia reutiliza su almacén durante la sesión', async () => {
  const root = await projectWith(undefined);
  const first = await openStory(root, KEY, { secretsDir: secrets });
  assert.equal((await openStory(root, KEY, { secretsDir: secrets })).store, first.store);
  closeStoryStores();
  assert.notEqual((await openStory(root, KEY, { secretsDir: secrets })).store, first.store);
});

test('una base sin confirmar no se abre', async () => {
  const kb = await localKb();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-res-root-'));
  await fs.writeJson(path.join(root, '.jira.json'), {
    projectKey: 'AQ',
    knowledge: { type: 'local', root: kb, baseFolder: 'PROY' },
  });
  await assert.rejects(openStory(root, KEY, { secretsDir: secrets }), /aún no está confirmada/);
});

test('listAllStories mezcla la base con lo que aún está en .jm, marca lo pendiente y no se rompe con un estado ilegible', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  const adr = path.join(kb, 'PROY', '02-JM-ADR');
  await fs.outputFile(path.join(adr, 'AQ-1', 'estado.json'), '{"summary":"En la base"}\n');
  await fs.outputFile(path.join(adr, 'AQ-2', 'estado.json'), '{ no es json');
  await fs.outputFile(path.join(adr, 'carpeta-ajena', 'x.md'), 'x');
  await fs.outputFile(path.join(legacyStoryDir(root, 'AQ-3'), 'estado.json'), '{"summary":"Pendiente"}\n');
  await fs.ensureDir(path.join(root, '.jm', 'historias', 'basura'));
  const stories = await listAllStories(root, { secretsDir: secrets });
  const byKey = Object.fromEntries(stories.map((s) => [s.key, s.summary]));
  assert.deepEqual(Object.keys(byKey).sort(), ['AQ-1', 'AQ-2', 'AQ-3']);
  assert.equal(byKey['AQ-1'], 'En la base');
  assert.match(byKey['AQ-2'], /estado ilegible/);
  assert.equal(byKey['AQ-3'], `Pendiente${PENDING_MOVE_SUFFIX}`);
});

test('listAllStories con MCP lee cada estado de la bóveda; sin PIN solo muestra lo local', async () => {
  seedVaultBase();
  const root = await projectWith(mcpConfig());
  vault.files.set('PROY/02-JM-ADR/AQ-7/estado.json', Buffer.from('{"summary":"En la bóveda"}\n'));
  await fs.outputFile(path.join(legacyStoryDir(root, 'AQ-8'), 'estado.json'), '{"summary":"Local"}\n');
  assert.deepEqual(
    (await listAllStories(root, { secretsDir: secrets })).map((s) => s.key),
    ['AQ-8'],
  );
  setSessionPin(PIN);
  const withPin = await listAllStories(root, { secretsDir: secrets });
  assert.deepEqual(withPin.map((s) => s.key).sort(), ['AQ-7', 'AQ-8']);
  assert.equal(withPin.find((s) => s.key === 'AQ-7')?.summary, 'En la bóveda');
});

test('el tablero va a la carpeta de trabajo con base y a .jm sin base', async () => {
  const none = await projectWith(undefined);
  await ensureStory((await openStory(none, KEY, { secretsDir: secrets })).store, KEY, 'Login', null);
  await refreshDashboard(none, undefined, { secretsDir: secrets });
  assert.match(await fs.readFile(path.join(none, '.jm', 'INICIO.md'), 'utf8'), /AQ-45/);

  const kb = await localKb();
  const withKb = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  const { store } = await openStory(withKb, KEY, { secretsDir: secrets });
  await ensureStory(store, KEY, 'Login', null);
  await updateState(store, KEY, (s) => {
    s.phase = 'plan';
  });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-res-work-'));
  await refreshDashboard(withKb, workDir, { secretsDir: secrets });
  assert.match(await fs.readFile(path.join(workDir, 'dashboard.md'), 'utf8'), /AQ-45.*plan/);
  assert.ok(!(await fs.pathExists(path.join(withKb, '.jm'))));
});

test('listAllStories con una base caída muestra lo de .jm con aviso y no falla', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  await fs.outputFile(path.join(legacyStoryDir(root, 'AQ-3'), 'estado.json'), '{"summary":"Pendiente"}\n');
  await fs.remove(kb);
  const stories = await listAllStories(root, { secretsDir: secrets });
  assert.deepEqual(
    stories.map((s) => s.key),
    ['AQ-3'],
  );
});

test('el listado se guarda en la sesión y un cambio de la historia lo invalida', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  const { store } = await openStory(root, KEY, { secretsDir: secrets });
  await ensureStory(store, KEY, 'Login', null);
  assert.deepEqual((await listAllStories(root, { secretsDir: secrets })).map((s) => s.key), [KEY]);
  await fs.outputFile(path.join(kb, 'PROY', '02-JM-ADR', 'AQ-9', 'estado.json'), '{"summary":"Nueva"}\n');
  assert.deepEqual((await listAllStories(root, { secretsDir: secrets })).map((s) => s.key), [KEY], 'sirve la caché');
  await updateState(store, KEY, (s) => {
    s.summary = 'Login v2';
  });
  assert.deepEqual((await listAllStories(root, { secretsDir: secrets })).map((s) => s.key).sort(), [KEY, 'AQ-9']);
});

test('una base local con una carpeta JM-ADR enlazada hacia fuera se rechaza antes de crear nada', async () => {
  const kb = await localKb();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-res-out-'));
  await fs.symlink(outside, path.join(kb, 'PROY', '02-JM-ADR'), process.platform === 'win32' ? 'junction' : 'dir');
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  await assert.rejects(openStory(root, KEY, { secretsDir: secrets }), /sale de la carpeta/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('al reabrir una historia en caché se vuelve a comprobar la confianza de la base', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  await openStory(root, KEY, { secretsDir: secrets });
  await fs.remove(path.join(secrets, 'knowledge-trust.json'));
  await fs.emptyDir(secrets);
  await assert.rejects(openStory(root, KEY, { secretsDir: secrets }), /aún no está confirmada/);
});

test('análisis con base local: viven en <JM-ADR>/analisis/<id>, se listan y no se confunden con historias', async () => {
  const kb = await localKb();
  const root = await projectWith({ type: 'local', root: kb, baseFolder: 'PROY' });
  const options = { secretsDir: secrets };
  const store = await openAnalysis(root, 'an-1', options);
  await createAnalysis(store, 'an-1', 'Observaciones', 'AQ');
  await ensureStory((await openStory(root, KEY, options)).store, KEY, 'Login', null);
  const adr = path.join(kb, 'PROY', '02-JM-ADR');
  for (const file of ['estado.json', 'bitacora.md']) {
    assert.ok(await fs.pathExists(path.join(adr, 'analisis', 'an-1', file)), file);
  }
  assert.ok(!(await fs.pathExists(path.join(root, '.jm'))));
  assert.deepEqual(await listAnalysisIds(root, options), ['an-1']);
  assert.deepEqual((await listAllAnalyses(root, options)).map((a) => a.name), ['Observaciones']);
  assert.deepEqual((await listAllStories(root, options)).map((s) => s.key), [KEY], 'el análisis no aparece como historia');
});

test('análisis con MCP: estado y fuentes quedan en la bóveda', async () => {
  setSessionPin(PIN);
  // La prueba anterior vacía los secretos
  await saveKnowledgeKey(mcpUrl, API_KEY, PIN, secrets);
  await saveKnowledgeCert(mcpUrl, TEST_CERT_A, secrets);
  seedVaultBase();
  const root = await projectWith(mcpConfig());
  const options = { secretsDir: secrets };
  const store = await openAnalysis(root, 'an-1', options);
  await createAnalysis(store, 'an-1', 'Observaciones', 'AQ');
  await store.writeBinary('fuentes/a.png', Buffer.from([1, 2]));
  const dir = 'PROY/02-JM-ADR/analisis/an-1';
  assert.ok(vault.files.has(`${dir}/estado.json`));
  assert.ok(vault.files.has(`${dir}/fuentes/a.png`));
  invalidateAnalysisListing(root);
  assert.deepEqual((await listAllAnalyses(root, options)).map((a) => a.id), ['an-1']);
  assert.equal((await readAnalysis(store, 'an-1'))?.projectKey, 'AQ');
});

test('análisis sin base: viven en .jm/analisis/<id> y un id inválido no abre nada', async () => {
  const root = await projectWith(undefined);
  const store = await openAnalysis(root, 'an-2');
  await createAnalysis(store, 'an-2', 'Suelto', 'AQ');
  assert.ok(await fs.pathExists(path.join(root, '.jm', 'analisis', 'an-2', 'estado.json')));
  assert.deepEqual(await listAnalysisIds(root), ['an-2']);
  assert.deepEqual((await listAllAnalyses(root)).map((a) => a.id), ['an-2']);
  await assert.rejects(openAnalysis(root, 'AQ-45'), /inválido/);
  await assert.rejects(openAnalysis(root, '../x'), /inválido/);
});

test('el listado de análisis sin base también se guarda en la sesión y invalidateAnalysisListing lo renueva', async () => {
  const root = await projectWith(undefined);
  await createAnalysis(await openAnalysis(root, 'an-1'), 'an-1', 'Uno', 'AQ');
  invalidateAnalysisListing(root);
  assert.equal((await listAllAnalyses(root)).length, 1);
  await createAnalysis(await openAnalysis(root, 'an-2'), 'an-2', 'Dos', 'AQ');
  assert.equal((await listAllAnalyses(root)).length, 1, 'sirve la caché');
  invalidateAnalysisListing(root);
  assert.equal((await listAllAnalyses(root)).length, 2);
});
