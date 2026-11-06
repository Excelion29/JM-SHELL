import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { createIndexUpdater, INDEX_FILE, upsertIndexRow } from './adr-index';
import { checkKbPath } from './kb-proxy';
import { createLocalStore } from './local-store';
import { ensureStory, updateState } from './state';
import type { StoryState } from './types';

const state = (patch: Partial<StoryState> = {}): StoryState => ({
  key: 'AQ-45',
  summary: 'Login | social',
  phase: 'debate',
  block: null,
  claudeSessionId: null,
  parentKey: null,
  createdIssues: {},
  taskRuns: {},
  attachments: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 },
  updatedAt: '2026-11-05T10:00:00.000Z',
  ...patch,
});

test('el índice usa un nombre que el proxy y Obsidian aceptan', () => {
  assert.equal(checkKbPath(`PROY/06-JM-ADR/${INDEX_FILE}`, 'PROY', true), null);
});

test('upsertIndexRow agrega la fila con enlace, reemplaza la de la misma historia y deja las demás', () => {
  const first = upsertIndexRow(null, state());
  assert.match(first, /\| \[\[AQ-45\]\] \| Login \\\| social \| debate \| — \|/);
  const second = upsertIndexRow(first, state({ key: 'AQ-12', summary: 'Otra', phase: 'plan' }));
  const third = upsertIndexRow(second, state({ phase: 'created', createdIssues: { T1: 'AQ-101', T2: 'AQ-102' } }));
  const rows = third.split('\n').filter((line) => line.startsWith('| [['));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /\[\[AQ-12\]\].*plan/);
  assert.match(rows[1], /\[\[AQ-45\]\].*creada.*AQ-101, AQ-102/);
});

test('jm actualiza el índice al crear la historia, cambiar de fase y crear tareas, pero no en cada turno', async () => {
  const adr = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-adr-'));
  const adrStore = createLocalStore({ kind: 'local', anchor: adr, dir: adr });
  const store = createLocalStore({ kind: 'local', anchor: adr, dir: path.join(adr, 'AQ-45') });
  store.onStoryChanged = createIndexUpdater(adrStore);
  const index = () => fs.readFile(path.join(adr, INDEX_FILE), 'utf8');

  await ensureStory(store, 'AQ-45', 'Login', null);
  assert.match(await index(), /\[\[AQ-45\]\] \| Login \| especificación/);
  await updateState(store, 'AQ-45', (s) => {
    s.phase = 'plan';
  });
  assert.match(await index(), /\[\[AQ-45\]\] \| Login \| plan/);
  await updateState(store, 'AQ-45', (s) => {
    s.createdIssues = { T1: 'AQ-101' };
  });
  assert.match(await index(), /AQ-101/);

  const before = await fs.stat(path.join(adr, INDEX_FILE));
  await updateState(store, 'AQ-45', (s) => {
    s.usage.turns += 1;
  });
  assert.equal((await fs.stat(path.join(adr, INDEX_FILE))).mtimeMs, before.mtimeMs, 'un turno no reescribe el índice');
});

test('el resumen no puede incrustar notas privadas ni HTML en el índice y se acota', () => {
  const hostile = upsertIndexRow(null, state({ summary: '![[Private]] <img src=x> `x`' }));
  const row = hostile.split('\n').find((line) => line.startsWith('| [[')) ?? '';
  const bs = String.fromCharCode(92);
  assert.ok(row.includes(`${bs}!${bs}[${bs}[Private${bs}]${bs}]`), row);
  assert.ok(row.includes(`${bs}<img src=x${bs}>`), row);
  assert.ok(!row.includes('![[Private') && !row.includes(' <img'), row);
  const long = upsertIndexRow(null, state({ summary: 'x'.repeat(5000) }));
  assert.ok(long.length < 1000);
});
