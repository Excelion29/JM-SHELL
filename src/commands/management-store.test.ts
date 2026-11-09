import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { tempRoot } from '../refinement/test-support';
import { readManagement, saveManagement } from './management-store';

const PROJECT_FILE = { projectKey: 'AQ', defaultAssignee: 'acc-1', knowledge: { type: 'none' } };
const AQ_MANAGEMENT = { key: 'AQ-7', summary: 'Gestión' };

async function rootWith(content: Record<string, unknown>): Promise<string> {
  const root = await tempRoot();
  await fs.writeJson(path.join(root, PROJECT_CONFIG_NAME), content);
  return root;
}

const readFile = (root: string) => fs.readJson(path.join(root, PROJECT_CONFIG_NAME));

test('sin campo management ni .jira.json el estado es unset', async () => {
  assert.equal(await readManagement(await rootWith(PROJECT_FILE), 'AQ'), 'unset');
  assert.equal(await readManagement(await tempRoot(), 'AQ'), 'unset');
});

test('guarda la gestión del proyecto y conserva el resto del .jira.json', async () => {
  const root = await rootWith(PROJECT_FILE);
  await saveManagement(root, 'AQ', AQ_MANAGEMENT);
  assert.deepEqual(await readManagement(root, 'AQ'), AQ_MANAGEMENT);
  assert.deepEqual(await readFile(root), { ...PROJECT_FILE, management: { AQ: AQ_MANAGEMENT } });
});

test('null queda como "no tiene" y es distinto de no haber respondido', async () => {
  const root = await rootWith(PROJECT_FILE);
  await saveManagement(root, 'AQ', null);
  assert.equal(await readManagement(root, 'AQ'), 'none');
  assert.deepEqual((await readFile(root)).management, { AQ: null });
});

test('cada proyecto tiene la suya: no se arrastra al cambiar y guardar otra no pisa las demás', async () => {
  const root = await rootWith({ ...PROJECT_FILE, management: { AQ: AQ_MANAGEMENT } });
  assert.equal(await readManagement(root, 'XY'), 'unset');
  await saveManagement(root, 'XY', { key: 'XY-3', summary: 'Otra' });
  assert.deepEqual(await readManagement(root, 'AQ'), AQ_MANAGEMENT);
  assert.deepEqual(await readManagement(root, 'XY'), { key: 'XY-3', summary: 'Otra' });
});

test('un valor ilegible cuenta como sin responder y al guardar se corrige', async () => {
  const root = await rootWith({ ...PROJECT_FILE, management: { AQ: { key: '../x', summary: 'mal' } } });
  assert.equal(await readManagement(root, 'AQ'), 'unset');
  await saveManagement(root, 'AQ', AQ_MANAGEMENT);
  assert.deepEqual(await readManagement(root, 'AQ'), AQ_MANAGEMENT);
  const broken = await rootWith({ ...PROJECT_FILE, management: 'texto' });
  assert.equal(await readManagement(broken, 'AQ'), 'unset');
  await saveManagement(broken, 'AQ', null);
  assert.deepEqual((await readFile(broken)).management, { AQ: null });
});

test('rechaza claves de proyecto o de issue inválidas y no hay .jira.json donde guardar', async () => {
  const root = await rootWith(PROJECT_FILE);
  await assert.rejects(saveManagement(root, '__proto__', null), /no es válida/);
  await assert.rejects(saveManagement(root, 'AQ', { key: 'no-es-clave', summary: 'x' }), /no es válida/);
  assert.deepEqual(await readFile(root), PROJECT_FILE);
  await assert.rejects(saveManagement(await tempRoot(), 'AQ', null), /No hay \.jira\.json/);
});
