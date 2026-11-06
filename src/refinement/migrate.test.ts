import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { FakeVault, startFakeVault } from './fake-vault';
import { createRestClient, RestClient } from './knowledge-rest';
import { createLocalStore } from './local-store';
import { backupStamp, legacyStoryDir, migrateLocalStory, renameLegacyChat } from './migrate';
import { TEST_CERT_A } from './test-certs';
import type { StoryStore } from './story-store';
import { createVaultStore } from './vault-store';

const API_KEY = 'fake-key-for-migration-tests';
const KEY = 'AQ-45';
const VAULT_DIR = `PROY/00-JM-ADR/${KEY}`;
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]);
const NOW = new Date(2026, 10, 5, 17, 30);
const CHAT_LINE = '{"role":"user","text":"hola","at":"t"}\n';

let vault: FakeVault;
let client: RestClient;
before(async () => {
  vault = await startFakeVault(API_KEY);
  client = createRestClient({ origin: vault.origin, apiKey: API_KEY, ca: TEST_CERT_A });
});
after(async () => {
  client.close();
  await vault.close();
});

const vaultStore = (): StoryStore => {
  vault.files.clear();
  vault.requests.length = 0;
  return createVaultStore({ client, baseFolder: 'PROY', dir: VAULT_DIR, label: 'falso' });
};

async function projectWithStory(extra: Record<string, string | Buffer> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-'));
  const dir = legacyStoryDir(root, KEY);
  const files: Record<string, string | Buffer> = {
    'estado.json': '{"summary":"Login"}\n',
    'bitacora.md': '# Bitácora AQ-45\n\nhecho\n',
    'historia.md': '# historia',
    'plan.json': '{"storyKey":"AQ-45","tasks":[]}\n',
    'adjuntos/1-captura.png': BINARY,
    '.chat.jsonl': CHAT_LINE,
    ...extra,
  };
  for (const [name, content] of Object.entries(files)) await fs.outputFile(path.join(dir, name), content);
  await fs.writeFile(path.join(root, '.jm', 'agents.json'), '{}');
  await fs.writeFile(path.join(root, '.jm', 'INICIO.md'), '# inicio');
  await fs.writeFile(path.join(root, '.jm', '.gitignore'), 'historias/*/adjuntos/\n');
  return root;
}

test('copia todo a la base (binario idéntico, chat renombrado), borra lo local y limpia .jm vacío', async () => {
  const root = await projectWithStory();
  const target = vaultStore();
  const result = await migrateLocalStory(root, KEY, target, NOW);
  assert.deepEqual(result, { moved: true });
  assert.equal(await target.readText('estado.json'), '{"summary":"Login"}\n');
  assert.equal(await target.readText('conversacion.jsonl'), CHAT_LINE);
  const png = await target.readBinary('adjuntos/1-captura.png', 1024);
  assert.ok(png && Buffer.compare(png, BINARY) === 0);
  assert.ok(!(await fs.pathExists(path.join(root, '.jm'))), '.jm desaparece cuando queda vacío');
});

test('estado.json se copia al final: si el corte llega antes, la base no cuenta la historia como migrada', async () => {
  const root = await projectWithStory();
  const target = vaultStore();
  const order: string[] = [];
  const spying: StoryStore = {
    ...target,
    writeText: async (name, content) => {
      order.push(name);
      if (name === 'estado.json') throw new Error('corte');
      await target.writeText(name, content);
    },
  };
  await assert.rejects(migrateLocalStory(root, KEY, spying, NOW), /corte/);
  assert.equal(order.at(-1), 'estado.json');
  assert.equal(await target.exists('estado.json'), false);
  assert.ok(await fs.pathExists(legacyStoryDir(root, KEY)), 'lo local sigue intacto');
});

test('una migración interrumpida se reanuda sin volver a copiar lo que ya coincide', async () => {
  const root = await projectWithStory();
  const target = vaultStore();
  await target.writeBinary('adjuntos/1-captura.png', BINARY);
  await target.writeText('bitacora.md', '# Bitácora AQ-45\n\nhecho\n');
  const result = await migrateLocalStory(root, KEY, target, NOW);
  assert.equal(result.moved, true);
  assert.equal(vault.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('captura.png')).length, 1);
  assert.equal(vault.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('bitacora.md')).length, 1);
  assert.ok(await target.exists('estado.json'));
  assert.ok(!(await fs.pathExists(legacyStoryDir(root, KEY))));
});

test('interrumpida justo antes de borrar lo local: se reconoce como terminada y solo se limpia', async () => {
  const root = await projectWithStory();
  const target = vaultStore();
  await migrateLocalStory(root, KEY, target, NOW);
  await fs.outputFile(path.join(legacyStoryDir(root, KEY), 'estado.json'), '{"summary":"Login"}\n');
  await fs.outputFile(path.join(legacyStoryDir(root, KEY), 'bitacora.md'), '# Bitácora AQ-45\n\nhecho\n');
  const result = await migrateLocalStory(root, KEY, target, NOW);
  assert.deepEqual(result, { moved: true });
  assert.ok(!(await fs.pathExists(legacyStoryDir(root, KEY))));
});

test('conflicto: gana la base, lo local se renombra como respaldo con aviso y .jm queda ignorado por git', async () => {
  const root = await projectWithStory();
  await fs.ensureDir(path.join(root, '.git', 'objects'));
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const target = vaultStore();
  await target.writeText('estado.json', '{"summary":"Versión de la base"}\n');
  const result = await migrateLocalStory(root, KEY, target, NOW);
  const backup = `${KEY}.respaldo-${backupStamp(NOW)}`;
  assert.equal(backupStamp(NOW), '20261105-1730');
  assert.equal(result.moved, false);
  assert.match(result.notice ?? '', new RegExp(`usé la de la base.*${backup}`));
  assert.equal(await target.readText('estado.json'), '{"summary":"Versión de la base"}\n');
  assert.ok(await fs.pathExists(path.join(root, '.jm', 'historias', backup, 'estado.json')));
  assert.ok(!(await fs.pathExists(legacyStoryDir(root, KEY))));
  assert.match(await fs.readFile(path.join(root, '.git', 'info', 'exclude'), 'utf8'), /^\/\.jm\/$/m);
});

test('un archivo que la base no admite (nombre con punto) deja lo local en su lugar y avisa', async () => {
  const root = await projectWithStory({ '.DS_Store': 'x' });
  const target = vaultStore();
  const result = await migrateLocalStory(root, KEY, target, NOW);
  assert.match(result.notice ?? '', /1 archivo\(s\)/);
  assert.ok(await fs.pathExists(path.join(legacyStoryDir(root, KEY), '.DS_Store')));
  assert.ok(await target.exists('estado.json'));
});

test('sin carpeta local no hay nada que mover', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-'));
  assert.deepEqual(await migrateLocalStory(root, KEY, vaultStore(), NOW), { moved: false });
});

test('migra también a una carpeta local de la base y renameLegacyChat conserva el contenido', async () => {
  const root = await projectWithStory();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-kb-'));
  const target = createLocalStore({ kind: 'local', anchor: dir, dir });
  assert.equal((await migrateLocalStory(root, KEY, target, NOW)).moved, true);
  assert.equal(await fs.readFile(path.join(dir, 'conversacion.jsonl'), 'utf8'), CHAT_LINE);
  const legacy = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-chat-'));
  await fs.writeFile(path.join(legacy, '.chat.jsonl'), 'x');
  renameLegacyChat(legacy);
  assert.equal(await fs.readFile(path.join(legacy, 'conversacion.jsonl'), 'utf8'), 'x');
});

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

async function outsideFolder(): Promise<string> {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-out-'));
  await fs.outputFile(path.join(outside, 'estado.json'), '{"secret":true}');
  return outside;
}

async function assertUntouched(outside: string): Promise<void> {
  assert.equal(await fs.readFile(path.join(outside, 'estado.json'), 'utf8'), '{"secret":true}');
  assert.deepEqual(await fs.readdir(outside), ['estado.json']);
}

test('si .jm es un enlace, no lee ni copia ni borra nada fuera', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-'));
  const outside = await outsideFolder();
  await fs.outputFile(path.join(outside, 'historias', KEY, 'estado.json'), '{"secret":true}');
  await fs.symlink(outside, path.join(root, '.jm'), LINK_TYPE);
  const target = vaultStore();
  await assert.rejects(migrateLocalStory(root, KEY, target, NOW), /enlace simbólico o junction/);
  assert.equal(await target.exists('estado.json'), false);
  assert.ok(await fs.pathExists(path.join(outside, 'historias', KEY, 'estado.json')));
});

test('si historias es un enlace, no lee ni copia ni borra nada fuera', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-'));
  const outside = await outsideFolder();
  await fs.outputFile(path.join(outside, KEY, 'estado.json'), '{"secret":true}');
  await fs.ensureDir(path.join(root, '.jm'));
  await fs.symlink(outside, path.join(root, '.jm', 'historias'), LINK_TYPE);
  const target = vaultStore();
  await assert.rejects(migrateLocalStory(root, KEY, target, NOW), /enlace simbólico o junction/);
  assert.equal(await target.exists('estado.json'), false);
  assert.ok(await fs.pathExists(path.join(outside, KEY, 'estado.json')));
});

test('si la carpeta de la historia es un enlace, no copia ni borra nada fuera', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-'));
  const outside = await outsideFolder();
  await fs.ensureDir(path.join(root, '.jm', 'historias'));
  await fs.symlink(outside, legacyStoryDir(root, KEY), LINK_TYPE);
  const target = vaultStore();
  await assert.rejects(migrateLocalStory(root, KEY, target, NOW), /enlace simbólico o junction/);
  assert.equal(await target.exists('estado.json'), false);
  await assertUntouched(outside);
});

test('un enlace dentro de la historia detiene la migración sin borrar nada', async () => {
  const root = await projectWithStory();
  const outside = await outsideFolder();
  await fs.symlink(outside, path.join(legacyStoryDir(root, KEY), 'adjuntos', 'externa'), LINK_TYPE);
  await assert.rejects(migrateLocalStory(root, KEY, vaultStore(), NOW), /no sigo enlaces/);
  await assertUntouched(outside);
  assert.ok(await fs.pathExists(path.join(legacyStoryDir(root, KEY), 'estado.json')));
});

test('una migración parcial previa (solo queda lo no movible) no se respalda como conflicto', async () => {
  const root = await projectWithStory({ '.DS_Store': 'x' });
  const target = vaultStore();
  await migrateLocalStory(root, KEY, target, NOW);
  const again = await migrateLocalStory(root, KEY, target, NOW);
  assert.equal(again.moved, true);
  assert.match(again.notice ?? '', /1 archivo\(s\)/);
  assert.ok(await fs.pathExists(path.join(legacyStoryDir(root, KEY), '.DS_Store')));
  assert.deepEqual(
    (await fs.readdir(path.join(root, '.jm', 'historias'))).filter((n) => n.includes('respaldo')),
    [],
  );
});

test('un archivo con enlace duro cuenta como no movible y no se copia', async (t) => {
  const root = await projectWithStory();
  const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mig-out-')), 'secreto.md');
  await fs.writeFile(outside, 'secreto');
  try {
    fs.linkSync(outside, path.join(legacyStoryDir(root, KEY), 'enlace.md'));
  } catch {
    t.skip('no se pueden crear enlaces duros');
    return;
  }
  const target = vaultStore();
  const result = await migrateLocalStory(root, KEY, target, NOW);
  assert.match(result.notice ?? '', /1 archivo\(s\)/);
  assert.ok(!(await target.exists('enlace.md')));
  assert.ok(await fs.pathExists(path.join(legacyStoryDir(root, KEY), 'enlace.md')));
});

test('si el nombre del respaldo ya existe, agrega -2', async () => {
  const root = await projectWithStory();
  const backup = `${KEY}.respaldo-${backupStamp(NOW)}`;
  const taken = path.join(root, '.jm', 'historias', backup);
  await fs.outputFile(path.join(taken, 'previo.md'), 'previo');
  const target = vaultStore();
  await target.writeText('estado.json', '{"summary":"Versión de la base"}\n');
  await migrateLocalStory(root, KEY, target, NOW);
  assert.equal(await fs.readFile(path.join(taken, 'previo.md'), 'utf8'), 'previo');
  assert.ok(await fs.pathExists(path.join(root, '.jm', 'historias', `${backup}-2`, 'estado.json')));
});
