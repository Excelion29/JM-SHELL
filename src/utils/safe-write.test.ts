import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomicNoLinks } from './safe-write';

test('escribe un archivo nuevo y reemplaza uno existente sin dejar temporales', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-write-'));
  const file = path.join(dir, '.jira.json');
  writeFileAtomicNoLinks(file, 'uno');
  writeFileAtomicNoLinks(file, 'dos');
  assert.equal(await fs.readFile(file, 'utf8'), 'dos');
  assert.deepEqual(await fs.readdir(dir), ['.jira.json']);
});

test('rechaza escribir sobre un enlace simbólico', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-write-'));
  const target = path.join(dir, 'real.json');
  await fs.writeFile(target, 'original');
  const link = path.join(dir, '.jira.json');
  try {
    fs.symlinkSync(target, link, 'file');
  } catch (err: unknown) {
    t.skip(`no se pueden crear enlaces (${(err as NodeJS.ErrnoException).code})`);
    return;
  }
  assert.throws(() => writeFileAtomicNoLinks(link, 'malicioso'), /enlace simbólico/);
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
});
