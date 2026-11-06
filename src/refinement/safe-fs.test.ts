import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { assertNoLinks, safeEnsureDir, safeWriteFile } from './safe-fs';
import { stripControlChars } from './text';
import { legacyStoryDir } from './migrate';
import { ensureStory, listStoriesFrom, readState } from './state';
import { attachmentsPathOf, statePathOf, storeAt } from './test-support';
import { streamToFileWithCap } from './attachments';
import { Readable } from 'stream';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jm-safe-'));
}

// Devuelve false (y salta el test) si la plataforma no permite crear el enlace
function link(t: TestContext, target: string, linkPath: string, type: 'file' | 'dir' | 'junction'): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (err: unknown) {
    t.skip(`no se pueden crear enlaces (${(err as NodeJS.ErrnoException).code})`);
    return false;
  }
}

test('stripControlChars quita escapes y saltos de línea', () => {
  assert.equal(stripControlChars('Hola\u001b[31m rojo\u0007\nfin\u009b'), 'Hola[31m rojofin');
});

test('rechaza un directorio de historia que es junction hacia fuera', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  await fs.ensureDir(path.join(root, '.jm', 'historias'));
  if (!link(t, outside, legacyStoryDir(root, 'AQ-1'), 'junction')) return;
  await assert.rejects(ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'x', null), /seguridad/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('rechaza escribir sobre un archivo enlazado dentro de adjuntos', async (t) => {
  const root = await tempRoot();
  const outside = path.join(await tempRoot(), 'secreto.txt');
  await fs.writeFile(outside, 'original');
  await ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'x', null);
  await fs.ensureDir(attachmentsPathOf(root, 'AQ-1'));
  const dest = path.join(attachmentsPathOf(root, 'AQ-1'), 'a.png');
  if (!link(t, outside, dest, 'file')) return;
  assert.throws(() => assertNoLinks(root, dest), /seguridad/);
  assert.throws(() => safeWriteFile(root, dest, 'pisado'), /seguridad/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'original');
});

test('rechaza un enlace colgante (destino inexistente)', async (t) => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'x', null);
  await fs.ensureDir(attachmentsPathOf(root, 'AQ-1'));
  const missing = path.join(await tempRoot(), 'no-existe.txt');
  const dest = path.join(attachmentsPathOf(root, 'AQ-1'), 'b.png');
  if (!link(t, missing, dest, 'file')) return;
  assert.throws(() => safeWriteFile(root, dest, 'x'), /seguridad/);
  assert.equal(fs.existsSync(missing), false);
});

test('estado.json enlazado: la historia aparece como ilegible y no se lee', async (t) => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'x', null);
  const outside = path.join(await tempRoot(), 'otro.json');
  await fs.writeJson(outside, { summary: 'fuga' });
  await fs.remove(statePathOf(root, 'AQ-1'));
  if (!link(t, outside, statePathOf(root, 'AQ-1'), 'file')) return;
  await assert.rejects(readState(storeAt(root, 'AQ-1'), 'AQ-1'), /seguridad/);
  assert.match((await listStoriesFrom([{ key: 'AQ-1', store: storeAt(root, 'AQ-1') }]))[0].summary, /estado ilegible/);
});

test('rechaza rutas fuera de .jm', async () => {
  const root = await tempRoot();
  assert.throws(() => safeEnsureDir(root, path.join(root, 'otra')), /fuera de/);
});

test('streamToFileWithCap no escribe a través del destino y deja el archivo final', async () => {
  const dir = await tempRoot();
  const dest = path.join(dir, 'ok.bin');
  await streamToFileWithCap(Readable.from([Buffer.alloc(5)]), dest, 100);
  assert.deepEqual(await fs.readdir(dir), ['ok.bin']);
});
