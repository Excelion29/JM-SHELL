import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  assertSafeArgs,
  buildNewSessionArgs,
  buildResumeArgs,
  ClaudeRunner,
  launchClaude,
  resolveExecutable,
} from './claude';

const SAFE_SESSION = '123e4567-e89b-12d3-a456-426614174000';
const BAD_ARGS = ['x" & calc & "', '%PATH%', 'a|b', 'a^b', 'a<b', 'a>b', 'not-a-uuid', 'refinar AQ-45 & dir'];

test('assertSafeArgs acepta los argumentos previstos', () => {
  assert.doesNotThrow(() => assertSafeArgs(buildNewSessionArgs('AQ-45', SAFE_SESSION)));
  assert.doesNotThrow(() => assertSafeArgs(buildResumeArgs(SAFE_SESSION)));
});

for (const bad of BAD_ARGS) {
  test(`assertSafeArgs rechaza: ${bad}`, () => {
    assert.throws(() => assertSafeArgs(buildResumeArgs(bad)), /no permitido/);
  });
}

test('resolveExecutable en Windows ignora el script sin extensión y marca .cmd como shim', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jdf-bin-'));
  const pathExt = '.EXE;.CMD';
  await fs.writeFile(path.join(dir, 'claude'), '#!/bin/sh');
  await fs.writeFile(path.join(dir, 'claude.cmd'), '@echo off');
  assert.deepEqual(resolveExecutable('claude', dir, pathExt, true), {
    file: path.join(dir, 'claude.cmd'),
    needsShell: true,
  });
  await fs.writeFile(path.join(dir, 'claude.exe'), '');
  assert.equal(resolveExecutable('claude', dir, pathExt, true)?.needsShell, false);
  assert.equal(resolveExecutable('nada', dir, pathExt, true), null);
});

const FAST = { code: 1, elapsedMs: 100 };

function harness(results: Array<{ code: number | null; elapsedMs: number }>) {
  const calls: string[][] = [];
  const saved: string[] = [];
  const run: ClaudeRunner = async (args) => {
    calls.push(args);
    return results.shift() ?? { code: 0, elapsedMs: 0 };
  };
  return { calls, saved, run, saveSessionId: async (id: string) => void saved.push(id) };
}

test('sin sesión previa: crea una nueva con /refinar', async () => {
  const h = harness([{ code: 0, elapsedMs: 10 }]);
  await launchClaude({
    key: 'AQ-45',
    existingSessionId: null,
    cwd: '.',
    run: h.run,
    saveSessionId: h.saveSessionId,
    newSessionId: () => 'new-id',
  });
  assert.deepEqual(h.saved, ['new-id']);
  assert.deepEqual(h.calls, [['--session-id', 'new-id', '-n', 'refinar AQ-45', '/refinar AQ-45']]);
});

test('con sesión previa: retoma con --resume', async () => {
  const h = harness([{ code: 0, elapsedMs: 10 }]);
  await launchClaude({ key: 'AQ-45', existingSessionId: 'old', cwd: '.', run: h.run, saveSessionId: h.saveSessionId });
  assert.deepEqual(h.calls, [['--resume', 'old']]);
  assert.deepEqual(h.saved, []);
});

test('si --resume falla al instante: abre sesión nueva', async () => {
  const h = harness([FAST, { code: 0, elapsedMs: 10 }]);
  await launchClaude({
    key: 'AQ-45',
    existingSessionId: 'gone',
    cwd: '.',
    run: h.run,
    saveSessionId: h.saveSessionId,
    newSessionId: () => 'fresh',
  });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.saved, ['fresh']);
});

test('si --resume duró y salió con error: no abre otra sesión', async () => {
  const h = harness([{ code: 1, elapsedMs: 60000 }]);
  await launchClaude({ key: 'AQ-45', existingSessionId: 'old', cwd: '.', run: h.run, saveSessionId: h.saveSessionId });
  assert.equal(h.calls.length, 1);
});

test('resolveExecutable ignora entradas relativas del PATH', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jdf-rel-'));
  await fs.writeFile(path.join(dir, 'claude'), '');
  const relative = path.relative(process.cwd(), dir);
  assert.equal(resolveExecutable('claude', relative, '', false), null);
  assert.ok(resolveExecutable('claude', dir, '', false));
});
