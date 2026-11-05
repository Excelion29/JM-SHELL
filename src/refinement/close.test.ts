import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import { executeClose, prepareClose } from './close';
import { attachmentsDir, readState } from './state';
import { attachment, createFakeJira, seedStory, task, tempRoot } from './test-support';

const KEY = 'AQ-45';
const FILES = {
  'analisis.txt': 'abc',
  'subido.png': '12345',
  'cambiado.png': '123',
  'pendiente.png': '9',
  'suelto.txt': 'x',
};

async function setup(phase: 'created' | 'in-progress' | 'reviewed' = 'created') {
  const root = await tempRoot();
  await seedStory(root, KEY, [task('T1')], {
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
  return { root, ...fake };
}

const exists = (root: string, name: string) => fs.pathExists(path.join(attachmentsDir(root, KEY), name));

test('separa lo borrable (análisis y verificado) de lo que se conserva con su motivo', async () => {
  const { root, jira } = await setup();
  const preview = await prepareClose(jira, root, KEY);
  assert.deepEqual(preview.deletable.map((d) => d.file).sort(), ['analisis.txt', 'subido.png']);
  assert.match(preview.deletable.find((d) => d.file === 'subido.png')!.reason, /AQ-101/);
  const kept = Object.fromEntries(preview.kept.map((k) => [k.file, k.reason]));
  assert.match(kept['cambiado.png'], /no aparece con el mismo nombre y tamaño/);
  assert.match(kept['pendiente.png'], /no se subió/);
  assert.match(kept['suelto.txt'], /sin propósito|no tiene propósito/);
});

test('confirmar borra solo lo verificado y lo de análisis, y cierra la historia', async () => {
  const { root, jira } = await setup();
  const preview = await prepareClose(jira, root, KEY);
  const result = await executeClose(
    jira,
    root,
    KEY,
    preview.deletable.map((d) => d.file),
  );
  assert.deepEqual(result.deleted.sort(), ['analisis.txt', 'subido.png']);
  assert.equal(await exists(root, 'analisis.txt'), false);
  assert.equal(await exists(root, 'subido.png'), false);
  for (const kept of ['cambiado.png', 'pendiente.png', 'suelto.txt']) assert.equal(await exists(root, kept), true);
  assert.equal((await readState(root, KEY))?.phase, 'closed');
});

test('aunque se pida borrar un archivo sin verificar, no se borra', async () => {
  const { root, jira } = await setup();
  const result = await executeClose(jira, root, KEY, ['cambiado.png', 'pendiente.png', 'suelto.txt']);
  assert.deepEqual(result.deleted, []);
  for (const name of Object.keys(FILES)) assert.equal(await exists(root, name), true);
});

test('si Jira no responde el archivo se conserva con el motivo', async () => {
  const { root, jira } = await setup();
  jira.getAttachments = async () => {
    throw new Error('sin red');
  };
  const preview = await prepareClose(jira, root, KEY);
  assert.deepEqual(
    preview.deletable.map((d) => d.file),
    ['analisis.txt'],
  );
  assert.match(preview.kept.find((k) => k.file === 'subido.png')!.reason, /sin red/);
});

test('preparar el cierre no borra nada', async () => {
  const { root, jira } = await setup();
  await prepareClose(jira, root, KEY);
  for (const name of Object.keys(FILES)) assert.equal(await exists(root, name), true);
  assert.equal((await readState(root, KEY))?.phase, 'created');
});

test('solo se cierran historias con tareas creadas', async () => {
  const { root, jira } = await setup('reviewed');
  await assert.rejects(prepareClose(jira, root, KEY), /solo se cierran/);
});
