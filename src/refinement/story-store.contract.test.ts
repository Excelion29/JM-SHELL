import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { startFakeVault, FakeVault } from './fake-vault';
import { createRestClient, RestClient } from './knowledge-rest';
import { createLocalStore } from './local-store';
import { TEST_CERT_A } from './test-certs';
import type { StoryStore } from './story-store';
import { createVaultStore } from './vault-store';

const API_KEY = 'fake-key-for-contract-tests';
const BASE = 'PROY';
const VAULT_DIR = 'PROY/00-JM-ADR/AQ-45';
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x00]);
const MAX_BYTES = 1024;
const SMALL_CAP = 4;
const INVALID_NAMES = ['../x', 'a/../b', '.oculto', 'carpeta/.oculto', 'a\\b', '/abs', 'a//b', 'a:b', 'a%2e'];

interface Harness {
  store: StoryStore;
  close: () => Promise<void>;
}

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

const harnesses: Array<[string, () => Promise<Harness>]> = [
  [
    'LocalStore (proyecto)',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-contract-'));
      const dir = path.join(root, '.jm', 'historias', 'AQ-45');
      return {
        store: createLocalStore({ kind: 'project', anchor: path.join(root, '.jm'), dir }),
        close: async () => undefined,
      };
    },
  ],
  [
    'LocalStore (carpeta de la base)',
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-contract-kb-'));
      return { store: createLocalStore({ kind: 'local', anchor: dir, dir }), close: async () => undefined };
    },
  ],
  [
    'VaultStore (REST falso)',
    async () => {
      vault.files.clear();
      return {
        store: createVaultStore({ client, baseFolder: BASE, dir: VAULT_DIR, label: 'falso' }),
        close: async () => undefined,
      };
    },
  ],
];

for (const [label, make] of harnesses) {
  describe(`contrato de StoryStore: ${label}`, () => {
    let store: StoryStore;
    before(async () => {
      store = (await make()).store;
    });

    test('texto: lo que se escribe se lee igual y lo que no existe es null', async () => {
      assert.equal(await store.readText('estado.json'), null);
      await store.writeText('estado.json', '{"a":"ñandú"}\n');
      assert.equal(await store.readText('estado.json'), '{"a":"ñandú"}\n');
      await store.writeText('estado.json', '{"a":2}\n');
      assert.equal(await store.readText('estado.json'), '{"a":2}\n');
    });

    test('binario: ida y vuelta idéntica byte a byte, con subcarpetas', async () => {
      await store.writeBinary('adjuntos/1-captura.png', BINARY);
      const back = await store.readBinary('adjuntos/1-captura.png', MAX_BYTES);
      assert.ok(back && Buffer.compare(back, BINARY) === 0);
      assert.equal(await store.readBinary('adjuntos/no-esta.png', MAX_BYTES), null);
    });

    test('binario: pasar del tope falla en vez de devolver un archivo cortado', async () => {
      await assert.rejects(store.readBinary('adjuntos/1-captura.png', SMALL_CAP));
    });

    test('append agrega al final y crea el archivo si no existía', async () => {
      await store.append('conversacion.jsonl', '{"a":1}\n');
      await store.append('conversacion.jsonl', '{"b":2}\n');
      assert.equal(await store.readText('conversacion.jsonl'), '{"a":1}\n{"b":2}\n');
    });

    test('list separa archivos de carpetas y una carpeta inexistente es vacía', async () => {
      const entries = await store.list('');
      assert.ok(entries.some((e) => e.name === 'estado.json' && e.isFile));
      assert.ok(entries.some((e) => e.name === 'adjuntos' && !e.isFile));
      assert.deepEqual(
        (await store.list('adjuntos')).map((e) => e.name),
        ['1-captura.png'],
      );
      assert.deepEqual(await store.list('no-existe'), []);
    });

    test('exists y remove: borrar es idempotente', async () => {
      assert.equal(await store.exists('estado.json'), true);
      assert.equal(await store.exists('adjuntos/1-captura.png'), true);
      await store.remove('adjuntos/1-captura.png');
      assert.equal(await store.exists('adjuntos/1-captura.png'), false);
      await assert.doesNotReject(store.remove('adjuntos/1-captura.png'));
    });

    test('removeFolder: idempotente, no falla con carpetas inexistentes y no toca archivos de otras', async () => {
      await store.removeFolder('no-existe');
      await store.remove('adjuntos/1-captura.png');
      await store.removeFolder('adjuntos');
      await assert.doesNotReject(store.removeFolder('adjuntos'));
      assert.equal(await store.exists('estado.json'), true);
    });

    test('rechaza nombres con "..", "\\", segmentos con punto inicial o caracteres no permitidos', async () => {
      for (const name of INVALID_NAMES) {
        await assert.rejects(store.readText(name), /no permitido/, name);
        await assert.rejects(store.writeText(name, 'x'), /no permitido/, name);
        await assert.rejects(store.remove(name), /no permitido/, name);
      }
    });

    test('localPath: ruta real si es disco, null en la bóveda', () => {
      const local = store.localPath('plan.json');
      if (store.kind === 'vault') assert.equal(local, null);
      else assert.ok(local?.endsWith('plan.json'));
    });
  });
}

describe('VaultStore: reglas propias de la bóveda', () => {
  test('toda ruta queda dentro de la carpeta base', async () => {
    const store = createVaultStore({ client, baseFolder: 'OTRA', dir: VAULT_DIR, label: 'falso' });
    vault.requests.length = 0;
    await assert.rejects(store.writeText('estado.json', 'x'), /solo se puede escribir dentro de la carpeta base/);
    assert.equal(vault.requests.filter((r) => r.method === 'PUT' && r.path.startsWith(VAULT_DIR)).length, 0);
  });

  test('el texto viaja como text/markdown (la bóveda rechaza application/json) y el binario como octet-stream', async () => {
    vault.files.clear();
    vault.requests.length = 0;
    const store = createVaultStore({ client, baseFolder: BASE, dir: VAULT_DIR, label: 'falso' });
    await store.writeText('plan.json', '{}');
    await store.writeBinary('adjuntos/1-a.png', BINARY);
    const types = Object.fromEntries(
      vault.requests.filter((r) => r.method === 'PUT').map((r) => [r.path, r.contentType]),
    );
    assert.equal(types[`${VAULT_DIR}/plan.json`], 'text/markdown');
    assert.equal(types[`${VAULT_DIR}/adjuntos/1-a.png`], 'application/octet-stream');
  });

  test('una API key incorrecta falla con un mensaje claro y no escribe', async () => {
    const wrong = createRestClient({ origin: vault.origin, apiKey: 'otra', ca: TEST_CERT_A });
    const store = createVaultStore({ client: wrong, baseFolder: BASE, dir: VAULT_DIR, label: 'falso' });
    await assert.rejects(store.writeText('estado.json', 'x'), /API key no es válida/);
    wrong.close();
  });
});

test('el listado del almacén local trae el tamaño y el de la bóveda no', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-contract-cap-'));
  const local = createLocalStore({ kind: 'local', anchor: dir, dir });
  await fs.writeFile(path.join(dir, 'a.md'), 'hola');
  const listed = await local.list('');
  assert.equal(listed.find((e) => e.name === 'a.md')?.size, 4);
  assert.equal(await local.readText('a.md'), 'hola');
  const vaultStore = createVaultStore({ client, baseFolder: BASE, dir: VAULT_DIR, label: 'falso' });
  assert.equal(
    (await vaultStore.list('')).every((e) => e.size === undefined),
    true,
  );
});
