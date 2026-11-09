import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { upsertIndexRow } from './adr-index';
import { createLocalStore } from './local-store';
import {
  ensureStoryLink,
  linkStoryNote,
  repairStoryNotes,
  repairTaskNote,
  setFrontmatterField,
  taskNoteKeys,
  upsertTasksSection,
} from './note-links';
import { ensureStory, hasLogProgress } from './state';
import { task } from './test-support';
import type { RefinementPlan, StoryState } from './types';

const state = (patch: Partial<StoryState> = {}): StoryState => ({
  key: 'AQ-45',
  summary: 'Login',
  phase: 'in-progress',
  block: null,
  claudeSessionId: null,
  parentKey: null,
  createdIssues: { T1: 'AQ-101', T2: 'AQ-102' },
  taskRuns: {
    'AQ-101': {
      issueKey: 'AQ-101',
      claudeSessionId: null,
      startedAt: '2026-11-08T10:00:00.000Z',
      finishedAt: null,
      activeMs: 0,
      status: 'started',
    },
  },
  attachments: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 },
  updatedAt: '2026-11-08T10:00:00.000Z',
  ...patch,
});

const plan = { storyKey: 'AQ-45', tasks: [task('T1'), task('T2')] } as RefinementPlan;
const WITH_NOTE = new Set(['AQ-101']);

const NOTE = [
  '---',
  'historia: AQ-45',
  'fase: plan',
  'tareas: []',
  'tags: [tipo/decision]',
  '---',
  '',
  '# AQ-45 Login',
  '',
  '## Tareas (esperado 1h)',
  '1. Lo que escribió Claude',
  '',
].join('\n');

test('el índice enlaza solo las tareas que tienen nota (un enlace roto crearía una nota suelta)', () => {
  const index = upsertIndexRow(null, state(), WITH_NOTE);
  assert.match(index, /\| \[\[AQ-101\]\], AQ-102 \|/);
});

test('la nota de la historia pone al día fase y tareas, y agrega la sección de jm sin tocar lo de Claude', () => {
  const linked = linkStoryNote(NOTE, state(), plan, WITH_NOTE);
  assert.match(linked, /^fase: in-progress$/m);
  assert.match(linked, /^tareas: \[AQ-101, AQ-102\]$/m);
  assert.match(linked, /1\. Lo que escribió Claude/);
  assert.match(linked, /- \[\[AQ-101\]\] · Tarea T1 · en curso/);
  assert.match(linked, /- AQ-102 · Tarea T2$/m);
  // Idempotente: una segunda pasada no cambia nada y la sección no se duplica
  assert.equal(linkStoryNote(linked, state(), plan, WITH_NOTE), linked);
  const done = linkStoryNote(
    linked,
    state({ taskRuns: { 'AQ-101': { ...state().taskRuns['AQ-101'], status: 'done' } } }),
    plan,
    WITH_NOTE,
  );
  assert.match(done, /\[\[AQ-101\]\] · Tarea T1 · terminada/);
  assert.equal(done.match(/## Tareas en Jira/g)?.length, 1);
});

test('la ficha reemplaza una lista en varias líneas y una nota sin ficha queda igual', () => {
  const multi = '---\ntareas:\n  - A\n  - B\nfase: plan\n---\nCuerpo';
  assert.equal(setFrontmatterField(multi, 'tareas', '[X]'), '---\ntareas: [X]\nfase: plan\n---\nCuerpo');
  assert.equal(setFrontmatterField('# Sin ficha', 'fase', 'plan'), '# Sin ficha');
  assert.equal(upsertTasksSection('Texto', 'S'), 'Texto\n\nS\n');
});

test('con marcadores rotos o desordenados la nota no se toca (nunca se borra contenido de Claude)', () => {
  const linked = linkStoryNote(NOTE, state(), plan, WITH_NOTE);
  const start = linked.slice(linked.indexOf('<!-- jm:tareas'), linked.indexOf('-->') + 3);
  const end = '<!-- /jm:tareas -->';
  const orphanStart = linked.replace(end, '');
  assert.equal(upsertTasksSection(orphanStart, 'NUEVA'), orphanStart);
  const orphanEnd = linked.replace(start, '');
  assert.equal(upsertTasksSection(orphanEnd, 'NUEVA'), orphanEnd);
  const reversed = `${end}\nTexto de Claude\n${start}`;
  assert.equal(upsertTasksSection(reversed, 'NUEVA'), reversed);
});

test('una nota con CRLF conserva su fin de línea', () => {
  const crlf = NOTE.replace(/\n/g, '\r\n');
  const linked = linkStoryNote(crlf, state(), plan, WITH_NOTE);
  assert.ok(!/[^\r]\n/.test(linked), 'sin saltos sueltos');
  assert.match(linked, /fase: in-progress\r\n/);
  assert.equal(ensureStoryLink('# B\r\n\r\nX', 'AQ-45'), '# B\r\n\r\nHistoria: [[AQ-45]]\r\n\r\nX');
});

test('sin título, el enlace va tras la ficha YAML y no la rompe', () => {
  assert.equal(ensureStoryLink('---\na: 1\n---\nTexto', 'AQ-45'), '---\na: 1\n---\nHistoria: [[AQ-45]]\n\nTexto');
  assert.equal(ensureStoryLink('Texto', 'AQ-45'), 'Historia: [[AQ-45]]\n\nTexto');
});

test('el criterio suelto se conserva si la descripción no lo trae, aunque otra sección lo nombre', () => {
  const note =
    '# T\n\n## Descripción\n\nHacer algo\n\n## Criterio de terminado\n\n- Pasa\n\n## Bitácora reciente\n\nRevisé el criterio de terminado';
  assert.match(repairTaskNote(note, 'AQ-45', 'AQ-101'), /## Criterio de terminado\n\n- Pasa/);
});

test('historia y bitácora ganan el enlace bajo el título; el texto plano "Historia: CLAVE" pasa a enlace', () => {
  assert.equal(ensureStoryLink('# Bitácora AQ-45\n\nAlgo', 'AQ-45'), '# Bitácora AQ-45\n\nHistoria: [[AQ-45]]\n\nAlgo');
  assert.equal(ensureStoryLink('# T\n\nHistoria: AQ-45\n', 'AQ-45'), '# T\n\nHistoria: [[AQ-45]]\n');
  const already = '# T\nHistoria: [[AQ-45]]';
  assert.equal(ensureStoryLink(already, 'AQ-45'), already);
});

test('la nota de tarea vieja gana ficha y enlace, y pierde la indicación técnica y el criterio repetido', () => {
  const old = [
    '# AQ-101 · Tarea',
    '',
    'Historia: AQ-45',
    '',
    '## Descripción',
    '',
    'Hacer algo',
    '',
    '#### Criterio de terminado',
    '',
    '- Pasa',
    '',
    '## Criterio de terminado',
    '',
    '- Pasa',
    '',
    '## Nota de la historia',
    '',
    'Tienes una base por el MCP jm_kb...',
    '',
    '## Tareas anteriores (ya terminadas)',
    '',
    '- AQ-100 · Base de datos (su detalle está en tareas/AQ-100.md)',
    '',
  ].join('\n');
  const repaired = repairTaskNote(old, 'AQ-45', 'AQ-101');
  assert.ok(repaired.startsWith('---\nhistoria: AQ-45\ntarea: AQ-101\ntags: [tipo/tarea]\n---\n'));
  assert.match(repaired, /Historia: \[\[AQ-45\]\]/);
  assert.doesNotMatch(repaired, /Nota de la historia|jm_kb/);
  assert.equal(repaired.match(/Criterio de terminado/g)?.length, 1);
  assert.match(repaired, /## Tareas anteriores/);
  assert.match(repaired, /^- \[\[AQ-100\]\] · Base de datos$/m);
  assert.equal(repairTaskNote(repaired, 'AQ-45', 'AQ-101'), repaired);
});

test('repairStoryNotes repara tareas, historia y bitácora de la carpeta; ignora archivos que no son de tareas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-notas-'));
  const store = createLocalStore({ kind: 'local', anchor: dir, dir });
  await store.writeText('tareas/AQ-101.md', '# AQ-101 · T\n\nHistoria: AQ-45\n');
  await store.writeText('tareas/otro.md', '# no es tarea');
  await store.writeText('historia.md', '# [AQ-45] Login\n\nTexto');
  await store.writeText('bitacora.md', '# Bitácora AQ-45\n\n');
  assert.deepEqual([...(await taskNoteKeys(store))], ['AQ-101']);
  await repairStoryNotes(store, 'AQ-45');
  assert.match((await store.readText('tareas/AQ-101.md')) ?? '', /^---\nhistoria: AQ-45[\s\S]*Historia: \[\[AQ-45\]\]/);
  assert.equal(await store.readText('tareas/otro.md'), '# no es tarea');
  assert.match((await store.readText('historia.md')) ?? '', /Historia: \[\[AQ-45\]\]/);
  assert.match((await store.readText('bitacora.md')) ?? '', /Historia: \[\[AQ-45\]\]/);
  assert.equal(await hasLogProgress(store, 'AQ-45'), false, 'el enlace no cuenta como avance');
});

test('una historia nueva nace con la bitácora enlazada y sin avance', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-nueva-'));
  const store = createLocalStore({ kind: 'local', anchor: dir, dir });
  await ensureStory(store, 'AQ-45', 'Login', null);
  assert.match((await store.readText('bitacora.md')) ?? '', /Historia: \[\[AQ-45\]\]/);
  assert.equal(await hasLogProgress(store, 'AQ-45'), false);
});
