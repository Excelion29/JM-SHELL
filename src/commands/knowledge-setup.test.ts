import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { loadKnowledgeCert, loadKnowledgeKey } from '../config/knowledge-secrets';
import { isKnowledgeTrusted } from '../config/knowledge-trust';
import { TEST_CERT_A } from '../refinement/test-certs';
import { clearSession, setSessionPin } from '../utils/session';
import { readKnowledgeConfig } from './knowledge-runtime';
import {
  confirmKnowledge,
  describeKnowledge,
  inspectServer,
  knowledgeStatus,
  listKnowledge,
  previewKnowledge,
  saveKnowledge,
} from './knowledge-setup';

const FAKE_KEY = 'fake-key-for-tests';
const PIN = '1234';
const MCP_URL = 'https://127.0.0.1:27124/mcp';
const PREVIEW_MAX_LINES = 15;

const tempDir = (prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

async function projectRoot(config: Record<string, unknown> = { projectKey: 'AQ', defaultAssignee: 'acc-1' }) {
  const root = await tempDir('jm-kb-root-');
  await fs.writeJson(path.join(root, '.jira.json'), config);
  return root;
}

const readConfig = async (root: string) => fs.readJson(path.join(root, '.jira.json'));

test('knowledgeStatus: solo pregunta con proyecto y sin decisión previa', async () => {
  const secrets = await tempDir('jm-kb-secrets-');
  assert.equal(await knowledgeStatus(await projectRoot(), secrets), 'unset');
  const none = await projectRoot({ projectKey: 'AQ', knowledge: { type: 'none' } });
  assert.equal(await knowledgeStatus(none, secrets), 'set');
  assert.equal(await knowledgeStatus(await projectRoot({ defaultAssignee: 'x' }), secrets), 'set');
  assert.equal(await knowledgeStatus(await tempDir('jm-kb-empty-'), secrets), 'set');
});

test('una base que ya venía en el .jira.json queda "untrusted" hasta que el dev la confirma', async () => {
  const secrets = await tempDir('jm-kb-secrets-');
  const knowledge = { type: 'mcp', url: MCP_URL, baseFolder: 'PROYECTOS/X', tls: 'system' };
  const root = await projectRoot({ projectKey: 'AQ', knowledge });
  assert.equal(await knowledgeStatus(root, secrets), 'untrusted');
  assert.deepEqual(await describeKnowledge(root), { type: 'mcp', target: MCP_URL, baseFolder: 'PROYECTOS/X' });
  await confirmKnowledge(root, secrets);
  assert.equal(await knowledgeStatus(root, secrets), 'set');
  const changed = { ...knowledge, url: 'https://evil.example/mcp' };
  await fs.writeJson(path.join(root, '.jira.json'), { projectKey: 'AQ', knowledge: changed });
  assert.equal(await knowledgeStatus(root, secrets), 'untrusted');
  const local = await projectRoot({
    projectKey: 'AQ',
    knowledge: { type: 'local', root: 'C:\\notas', baseFolder: 'PROY' },
  });
  assert.deepEqual(await describeKnowledge(local), { type: 'local', target: 'C:\\notas', baseFolder: 'PROY' });
  await assert.rejects(
    describeKnowledge(await projectRoot({ projectKey: 'AQ', knowledge: { type: 'none' } })),
    /por confirmar/,
  );
});

test('lo configurado desde el asistente queda confirmado automáticamente', async () => {
  const root = await projectRoot();
  const secrets = await tempDir('jm-kb-secrets-');
  setSessionPin(PIN);
  try {
    const connection = { type: 'mcp', url: MCP_URL, apiKey: FAKE_KEY, certPem: null } as const;
    await saveKnowledge(root, { type: 'connect', baseFolder: 'PROYECTOS/X', connection }, secrets);
  } finally {
    clearSession();
  }
  const config = await readKnowledgeConfig(root);
  assert.ok(config && (await isKnowledgeTrusted(root, config, secrets)));
  assert.equal(await knowledgeStatus(root, secrets), 'set');
});

test('URLs con usuario o contraseña y carpetas locales inseguras se rechazan al guardar y al inspeccionar', async () => {
  const root = await projectRoot();
  setSessionPin(PIN);
  try {
    for (const url of ['https://user:pass@127.0.0.1:27124/mcp', 'https://token@127.0.0.1:27124/mcp']) {
      const connection = { type: 'mcp', url, apiKey: FAKE_KEY, certPem: null } as const;
      await assert.rejects(
        saveKnowledge(root, { type: 'connect', baseFolder: 'PROY', connection }),
        /usuario ni contraseña/,
      );
      await assert.rejects(inspectServer(url), /usuario ni contraseña/);
    }
  } finally {
    clearSession();
  }
  for (const bad of ['\\\\servidor\\recurso', '\\\\?\\C:\\notas', 'C:\\notas\\..\\otra', 'relativa', 'C:/notas']) {
    const connection = { type: 'local', root: bad } as const;
    await assert.rejects(
      saveKnowledge(root, { type: 'connect', baseFolder: 'PROY', connection }),
      /ruta absoluta completa/,
      bad,
    );
    await assert.rejects(listKnowledge(connection, ''), /ruta absoluta completa/, bad);
    await assert.rejects(previewKnowledge(connection, 'x.md'), /ruta absoluta completa/, bad);
  }
  assert.equal((await readConfig(root)).knowledge, undefined);
});

test('saveKnowledge "ninguna" conserva el proyecto y no se vuelve a preguntar', async () => {
  const root = await projectRoot();
  const secrets = await tempDir('jm-kb-secrets-');
  await saveKnowledge(root, { type: 'none' }, secrets);
  assert.deepEqual(await readConfig(root), { projectKey: 'AQ', defaultAssignee: 'acc-1', knowledge: { type: 'none' } });
  assert.equal(await knowledgeStatus(root, secrets), 'set');
});

test('saveKnowledge MCP guarda la key cifrada y el certificado fuera del .jira.json', async () => {
  const root = await projectRoot();
  const secrets = await tempDir('jm-kb-secrets-');
  setSessionPin(PIN);
  try {
    const connection = { type: 'mcp', url: MCP_URL, apiKey: FAKE_KEY, certPem: TEST_CERT_A } as const;
    await saveKnowledge(root, { type: 'connect', baseFolder: 'PROYECTOS/X', connection }, secrets);
  } finally {
    clearSession();
  }
  const saved = await readConfig(root);
  assert.equal(saved.projectKey, 'AQ');
  assert.deepEqual(saved.knowledge, { type: 'mcp', url: MCP_URL, baseFolder: 'PROYECTOS/X', tls: 'pinned' });
  assert.ok(!JSON.stringify(saved).includes(FAKE_KEY));
  assert.equal(await loadKnowledgeKey(MCP_URL, PIN, secrets), FAKE_KEY);
  assert.equal(await loadKnowledgeCert(MCP_URL, secrets), TEST_CERT_A);
});

test('saveKnowledge MCP sin PIN en memoria falla y no toca el .jira.json', async () => {
  const root = await projectRoot();
  clearSession();
  const connection = { type: 'mcp', url: MCP_URL, apiKey: FAKE_KEY, certPem: null } as const;
  await assert.rejects(saveKnowledge(root, { type: 'connect', baseFolder: 'PROY', connection }), /PIN/);
  assert.equal((await readConfig(root)).knowledge, undefined);
});

test('saveKnowledge rechaza una carpeta base con ..', async () => {
  const root = await projectRoot();
  const connection = { type: 'local', root: 'C:\\notas' } as const;
  await assert.rejects(saveKnowledge(root, { type: 'connect', baseFolder: '../fuera', connection }), /no es válida/);
});

test('la carpeta local se lista (carpetas primero, con la JM-ADR que se usaría) y se previsualiza', async () => {
  const kb = await tempDir('jm-kb-local-');
  await fs.ensureDir(path.join(kb, 'PROY', '02-Docs'));
  await fs.ensureDir(path.join(kb, 'PROY', '05-Otro'));
  await fs.writeFile(path.join(kb, 'PROY', 'README.md'), 'linea\n'.repeat(40));
  const connection = { type: 'local', root: kb } as const;
  const listing = await listKnowledge(connection, 'PROY');
  const names = listing.entries.map((e) => `${e.name}${e.isFolder ? '/' : ''}`);
  assert.deepEqual(names, ['02-Docs/', '05-Otro/', 'README.md']);
  assert.equal(listing.adrFolder, '06-JM-ADR');
  const preview = await previewKnowledge(connection, 'PROY/README.md');
  assert.ok(preview.split('\n').length <= PREVIEW_MAX_LINES);
  await assert.rejects(listKnowledge(connection, '../'), /no es válida/);
  await assert.rejects(previewKnowledge(connection, 'PROY/no-existe.md'), /No encontré/);
});

test('los nombres con controles C0/C1, bidi o separadores de línea no se listan; la vista previa se limpia', async () => {
  const kb = await tempDir('jm-kb-ctrl-');
  const hostile = ['a\u0080b', 'rtl\u202eexe.md', 'sep\u2028x', 'iso\u2066y', 'del\u007fz'];
  for (const name of hostile) await fs.writeFile(path.join(kb, name), 'x');
  await fs.writeFile(path.join(kb, 'normal.md'), 'x');
  const listing = await listKnowledge({ type: 'local', root: kb }, '');
  assert.deepEqual(
    listing.entries.map((e) => e.name),
    ['normal.md'],
  );
});

test('la vista previa lee solo el principio de una nota enorme', async () => {
  const kb = await tempDir('jm-kb-big-');
  await fs.writeFile(path.join(kb, 'enorme.md'), `${'linea\n'.repeat(500_000)}`);
  const preview = await previewKnowledge({ type: 'local', root: kb }, 'enorme.md');
  assert.ok(preview.split('\n').length <= PREVIEW_MAX_LINES);
});

test('un enlace (junction/symlink) que sale de la raíz no se puede listar ni previsualizar', async (t) => {
  const kb = await tempDir('jm-kb-link-');
  const outside = await tempDir('jm-kb-outside-');
  await fs.writeFile(path.join(outside, 'secreto.md'), 'privado');
  try {
    await fs.symlink(outside, path.join(kb, 'salida'), 'junction');
  } catch {
    t.skip('no se pudo crear el enlace en este entorno');
    return;
  }
  const connection = { type: 'local', root: kb } as const;
  await assert.rejects(listKnowledge(connection, 'salida'), /sale de la carpeta/);
  await assert.rejects(previewKnowledge(connection, 'salida/secreto.md'), /sale de la carpeta/);
});

test('saveKnowledge rechaza la raíz de la bóveda como carpeta base', async () => {
  const root = await projectRoot({ projectKey: 'AQ' });
  const connection = { type: 'local', root: 'C:\notas' } as const;
  await assert.rejects(saveKnowledge(root, { type: 'connect', baseFolder: '', connection }), /no la raíz/);
});
