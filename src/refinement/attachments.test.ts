import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import {
  assertSameOrigin,
  attachmentFileName,
  AttachmentTooLargeError,
  resolveInside,
  sanitizeFilename,
  streamToFileWithCap,
} from './attachments';

test('sanitizeFilename: casos peligrosos', () => {
  assert.equal(sanitizeFilename('NUL.txt'), '_NUL.txt');
  assert.equal(sanitizeFilename('com1'), '_com1');
  assert.equal(sanitizeFilename('a:b'), 'a_b');
  assert.equal(sanitizeFilename('..'), 'file');
  assert.equal(sanitizeFilename('name. '), 'name');
  assert.equal(sanitizeFilename('..\\..\\evil.txt'), 'evil.txt');
  assert.equal(sanitizeFilename('../x/captura final.png'), 'captura final.png');
  assert.equal(sanitizeFilename('ok-1.2.pdf'), 'ok-1.2.pdf');
});

test('attachmentFileName antepone el id', () => {
  assert.equal(attachmentFileName('10042', 'NUL.txt'), '10042-_NUL.txt');
});

test('resolveInside rechaza salirse de la carpeta', () => {
  const dir = path.join(os.tmpdir(), 'adj');
  assert.equal(resolveInside(dir, 'a.txt'), path.join(path.resolve(dir), 'a.txt'));
  assert.throws(() => resolveInside(dir, '../x.txt'), /fuera de/);
  assert.throws(() => resolveInside(dir, 'sub/x.txt'), /fuera de/);
});

test('assertSameOrigin rechaza otro origen', () => {
  const base = 'https://acme.atlassian.net';
  assert.doesNotThrow(() => assertSameOrigin('https://acme.atlassian.net/rest/api/3/attachment/content/1', base));
  assert.throws(() => assertSameOrigin('https://evil.example.com/x', base), /no pertenece/);
  assert.throws(() => assertSameOrigin('http://acme.atlassian.net/x', base), /no pertenece/);
});

test('streamToFileWithCap escribe bajo el tope', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-att-')), 'ok.bin');
  await streamToFileWithCap(Readable.from([Buffer.alloc(10), Buffer.alloc(10)]), dest, 100);
  assert.equal((await fs.stat(dest)).size, 20);
});

test('streamToFileWithCap aborta y borra el parcial al superar el tope', async () => {
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-att-')), 'big.bin');
  const source = Readable.from([Buffer.alloc(60), Buffer.alloc(60), Buffer.alloc(60)]);
  await assert.rejects(streamToFileWithCap(source, dest, 100), AttachmentTooLargeError);
  assert.equal(await fs.pathExists(dest), false);
});
