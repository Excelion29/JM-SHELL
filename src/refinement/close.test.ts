import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import { executeClose, prepareClose } from './close';
import { ATTACHMENTS_DIR, readState, STORIES_DIR } from './state';
import { startFakeVault } from './fake-vault';
import { createRestClient } from './knowledge-rest';
import { TEST_CERT_A } from './test-certs';
import { createVaultStore } from './vault-store';
import { attachment, createFakeJira, seedStory, storeAt, task, tempRoot } from './test-support';

const KEY = 'AQ-45';
const VAULT_KEY = 'fake-key-for-close-tests';
const FILES = {
  'analisis.txt': 'abc',
  'subido.png': '12345',
  'cambiado.png': '123',
  'pendiente.png': '9',
  'suelto.txt': 'x',
};

async function setup(phase: 'created' | 'in-progress' | 'reviewed' = 'created') {
  const root = await tempRoot();
  const store = storeAt(root);
  await seedStory(store, KEY, [task('T1')], {
    phase,
    files: FILES,
    attachments: [
      attachment('analisis.txt', { purpose: 'analysis' }),
      attachment('subido.png', { purpose: 'evidence', uploaded: { 'AQ-101': 'a1' } }),
      attachment('cambiado.png', { purpose: 'team', uploaded: { 'AQ-101': 'a2' } }),
      attachment('pendiente.png', { purpose: 'evidence' }),
    ],
  });
  const fake = createFakeJira({
    remote: {
      'AQ-101': [
        { filename: 'subido.png', size: 5 },
        { filename: 'cambiado.png', size: 999 },
      ],
    },
  });
  return { root, store, ...fake };
}

const exists = (root: string, name: string) => fs.pathExists(path.join(root, ".jm", STORIES_DIR, KEY, ATTACHMENTS_DIR, name));

test('separa lo borrable (análisis y verificado) de lo que se conserva con su motivo', async () => {
  const { store, jira } = await setup();
  const preview = await prepareClose(jira, store, KEY);
  assert.deepEqual(preview.deletable.map((d) => d.file).sort(), ['analisis.txt', 'subido.png']);
  assert.match(preview.deletable.find((d) => d.file === 'subido.png')!.reason, /AQ-101/);
  const kept = Object.fromEntries(preview.kept.map((k) => [k.file, k.reason]));
  assert.match(kept['cambiado.png'], /no aparece con el mismo nombre y tamaño/);
  assert.match(kept['pendiente.png'], /no se subió/);
  assert.match(kept['suelto.txt'], /sin propósito|no tiene propósito/);
});

test('confirmar borra solo lo verificado y lo de análisis, y cierra la historia', async () => {
  const { root, store, jira } = await setup();
  const preview = await prepareClose(jira, store, KEY);
  const result = await executeClose(
    jira,
    store,
    KEY,
    preview.deletable.map((d) => d.file),
  );
  assert.deepEqual(result.deleted.sort(), ['analisis.txt', 'subido.png']);
  assert.equal(await exists(root, 'analisis.txt'), false);
  assert.equal(await exists(root, 'subido.png'), false);
  for (const kept of ['cambiado.png', 'pendiente.png', 'suelto.txt']) assert.equal(await exists(root, kept), true);
  assert.equal((await readState(store, KEY))?.phase, 'closed');
});

test('aunque se pida borrar un archivo sin verificar, no se borra', async () => {
  const { root, store, jira } = await setup();
  const result = await executeClose(jira, store, KEY, ['cambiado.png', 'pendiente.png', 'suelto.txt']);
  assert.deepEqual(result.deleted, []);
  for (const name of Object.keys(FILES)) assert.equal(await exists(root, name), true);
});

test('si Jira no responde el archivo se conserva con el motivo', async () => {
  const { store, jira } = await setup();
  jira.getAttachments = async () => {
    throw new Error('sin red');
  };
  const preview = await prepareClose(jira, store, KEY);
  assert.deepEqual(
    preview.deletable.map((d) => d.file),
    ['analisis.txt'],
  );
  assert.match(preview.kept.find((k) => k.file === 'subido.png')!.reason, /sin red/);
});

test('preparar el cierre no borra nada', async () => {
  const { root, store, jira } = await setup();
  await prepareClose(jira, store, KEY);
  for (const name of Object.keys(FILES)) assert.equal(await exists(root, name), true);
  assert.equal((await readState(store, KEY))?.phase, 'created');
});

test('solo se cierran historias con tareas creadas', async () => {
  const { store, jira } = await setup('reviewed');
  await assert.rejects(prepareClose(jira, store, KEY), /solo se cierran/);
});

test('con la historia en la bóveda el cierre compara tamaños y borra solo lo verificado', async () => {
  const vault = await startFakeVault(VAULT_KEY);
  const client = createRestClient({ origin: vault.origin, apiKey: VAULT_KEY, ca: TEST_CERT_A });
  try {
    const store = createVaultStore({ client, baseFolder: 'PROY', dir: 'PROY/00-JM-ADR/AQ-45', label: 'falso' });
    await seedStory(store, KEY, [task('T1')], {
      phase: 'created',
      files: FILES,
      attachments: [
        attachment('analisis.txt', { purpose: 'analysis' }),
        attachment('subido.png', { purpose: 'evidence', uploaded: { 'AQ-101': 'a1' } }),
        attachment('cambiado.png', { purpose: 'team', uploaded: { 'AQ-101': 'a2' } }),
      ],
    });
    const { jira } = createFakeJira({
      remote: { 'AQ-101': [{ filename: 'subido.png', size: 5 }, { filename: 'cambiado.png', size: 999 }] },
    });
    const preview = await prepareClose(jira, store, KEY);
    assert.deepEqual(preview.deletable.map((d) => d.file).sort(), ['analisis.txt', 'subido.png']);
    const result = await executeClose(jira, store, KEY, ['analisis.txt', 'subido.png', 'cambiado.png']);
    assert.deepEqual(result.deleted.sort(), ['analisis.txt', 'subido.png']);
    assert.equal(await store.exists('adjuntos/subido.png'), false);
    assert.equal(await store.exists('adjuntos/cambiado.png'), true);
    assert.equal((await readState(store, KEY))?.phase, 'closed');
  } finally {
    client.close();
    await vault.close();
  }
});
