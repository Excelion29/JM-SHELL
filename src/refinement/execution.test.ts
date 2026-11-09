import { test } from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'node:assert/strict';
import type { JiraIssue, JiraTransition } from '../config/types';
import {
  categoryOf,
  deleteTasks,
  ExecutionJira,
  finishTask,
  loadMyDay,
  loadTaskRows,
  prepareTaskContext,
  renderTaskContext,
  retryPending,
  returnOptions,
  returnTo,
  startTask,
  taskContextName,
} from './execution';
import { readState, updateState } from './state';
import { createFileTransitionMemory, type TransitionMemory } from './transition-memory';
import { seedStory, storeAt, task, tempRoot } from './test-support';

const STORY = 'AQ-45';
const T1 = 'AQ-101';
const T2 = 'AQ-102';
const EXTRA = 'AQ-103';
const FIXED_NOW = new Date('2026-11-05T15:00:00.000Z');

interface FakeIssue {
  summary?: string;
  status: string;
  category: 'new' | 'indeterminate' | 'done';
  assignee?: string;
  estimate?: number | null;
  due?: string | null;
  parent?: string;
  description?: unknown;
}

interface FakeOptions {
  issues: Record<string, FakeIssue>;
  transitions?: Record<string, JiraTransition[]>;
  down?: boolean;
  denyDelete?: string[];
}

const toIssue = (key: string, f: FakeIssue): JiraIssue => ({
  id: key,
  key,
  fields: {
    summary: f.summary ?? `Resumen ${key}`,
    status: { name: f.status, statusCategory: { key: f.category } },
    assignee: f.assignee ? { displayName: f.assignee, accountId: 'acc' } : null,
    duedate: f.due ?? null,
    timeoriginalestimate: f.estimate ?? null,
    issuetype: { name: 'Subtarea' },
    parent: f.parent ? { key: f.parent, fields: { summary: 'Historia' } } : undefined,
    description: f.description,
  },
});

const START_TRANSITIONS: JiraTransition[] = [
  { id: '11', name: 'Iniciar trabajo', to: { name: 'En curso' } },
  { id: '12', name: 'Backlog', to: { name: 'Backlog' } },
];
const DONE_TRANSITIONS: JiraTransition[] = [{ id: '31', name: 'Cerrar', to: { name: 'Finalizada' } }];

function fakeJira(options: FakeOptions) {
  const calls = {
    transitions: [] as Array<{ key: string; id: string }>,
    deleted: [] as string[],
    searches: [] as string[],
  };
  const guard = () => {
    if (options.down) throw new Error('Jira API error (503): caído');
  };
  const jira: ExecutionJira = {
    getIssue: async (key) => {
      guard();
      return toIssue(key, options.issues[key]);
    },
    getIssueWithDescription: async (key) => toIssue(key, options.issues[key]),
    getTransitions: async (key) => {
      guard();
      return options.transitions?.[key] ?? [];
    },
    doTransition: async (key, id) => {
      guard();
      calls.transitions.push({ key, id });
    },
    searchIssues: async (jql) => {
      guard();
      calls.searches.push(jql);
      return Object.entries(options.issues).map(([key, f]) => toIssue(key, f));
    },
    deleteIssue: async (key) => {
      if (options.denyDelete?.includes(key)) throw new Error('Permission denied: sin permiso');
      calls.deleted.push(key);
    },
  };
  return { jira, calls };
}

async function setup(options: FakeOptions) {
  const root = await tempRoot();
  const store = storeAt(root, STORY);
  await seedStory(store, STORY, [task('T1', { finalEstimate: '2h' }), task('T2')], { phase: 'created' });
  await updateState(store, STORY, (s) => {
    s.createdIssues = { T1, T2 };
  });
  const fake = fakeJira(options);
  return { store, ctx: { jira: fake.jira, store, now: () => FIXED_NOW }, calls: fake.calls };
}

const ISSUES: Record<string, FakeIssue> = {
  [T1]: { status: 'Por hacer', category: 'new', parent: STORY, estimate: 3600, assignee: 'Ana' },
  [T2]: { status: 'En curso', category: 'indeterminate', parent: STORY },
  [EXTRA]: { status: 'Por hacer', category: 'new', parent: STORY, assignee: 'Luis', summary: 'Extra' },
};

test('las filas mezclan plan y Jira: la estimación de Jira gana, la del plan completa y lo extra se marca', async () => {
  const { ctx } = await setup({ issues: ISSUES });
  const model = await loadTaskRows(ctx, STORY);
  const byKey = Object.fromEntries(model.rows.map((r) => [r.key, r]));
  assert.equal(byKey[T1].estimateSeconds, 3600);
  assert.equal(byKey[T2].estimateSeconds, 3900);
  assert.equal(byKey[T1].assignee, 'Ana');
  assert.equal(byKey[T1].inPlan, true);
  assert.equal(byKey[EXTRA].inPlan, false);
  assert.equal(byKey[EXTRA].assignee, 'Luis');
});

test('una clave del registro que Jira no devuelve sale como no encontrada', async () => {
  const { ctx } = await setup({ issues: { [T1]: ISSUES[T1] } });
  const row = (await loadTaskRows(ctx, STORY)).rows.find((r) => r.key === T2);
  assert.equal(row?.missing, true);
});

test('iniciar hace la transición a En curso (por estado destino), guarda la hora y avanza la fase', async () => {
  const { ctx, calls, store } = await setup({ issues: ISSUES, transitions: { [T1]: START_TRANSITIONS } });
  const outcome = await startTask(ctx, STORY, T1);
  assert.deepEqual(outcome, { kind: 'ok', storyKey: STORY });
  assert.deepEqual(calls.transitions, [{ key: T1, id: '11' }]);
  const state = await readState(store, STORY);
  assert.equal(state?.taskRuns[T1].startedAt, FIXED_NOW.toISOString());
  assert.equal(state?.phase, 'in-progress');
});

test('iniciar una tarea ya en curso no transiciona y conserva la hora de inicio', async () => {
  const { ctx, calls, store } = await setup({ issues: ISSUES });
  await startTask(ctx, STORY, T2);
  const first = (await readState(store, STORY))?.taskRuns[T2].startedAt;
  await startTask({ ...ctx, now: () => new Date('2026-11-06T09:00:00.000Z') }, STORY, T2);
  assert.deepEqual(calls.transitions, []);
  assert.equal((await readState(store, STORY))?.taskRuns[T2].startedAt, first);
});

test('una tarea finalizada pide confirmar antes de reabrirse', async () => {
  const issues = { ...ISSUES, [T1]: { ...ISSUES[T1], status: 'Finalizada', category: 'done' as const } };
  const { ctx, calls } = await setup({ issues, transitions: { [T1]: START_TRANSITIONS } });
  assert.deepEqual(await startTask(ctx, STORY, T1), { kind: 'needs-reopen' });
  assert.deepEqual(calls.transitions, []);
  assert.equal((await startTask(ctx, STORY, T1, { reopen: true })).kind, 'ok');
  assert.equal(calls.transitions.length, 1);
});

test('si no hay transición a En curso ofrece las disponibles y aplica la elegida', async () => {
  const { ctx, calls } = await setup({ issues: ISSUES, transitions: { [T1]: [START_TRANSITIONS[1]] } });
  assert.deepEqual(await startTask(ctx, STORY, T1), { kind: 'choose', available: ['Backlog'] });
  assert.equal((await startTask(ctx, STORY, T1, { transitionName: 'Backlog' })).kind, 'ok');
  assert.deepEqual(calls.transitions, [{ key: T1, id: '12' }]);
});

test('Jira caído al iniciar bloquea sin registrar nada', async () => {
  const { ctx, store } = await setup({ issues: ISSUES, down: true });
  const outcome = await startTask(ctx, STORY, T1);
  assert.equal(outcome.kind, 'failed');
  assert.deepEqual((await readState(store, STORY))?.taskRuns, {});
});

test('el contexto trae título y criterio de terminado y ningún dato sensible', async () => {
  const { ctx, store } = await setup({ issues: ISSUES });
  const text = await prepareTaskContext(ctx, STORY, T1, 'Nota en JM-ADR/AQ-45.md');
  assert.match(text, /Resumen AQ-101/);
  assert.match(text, /Pasa el test/);
  assert.match(text, /JM-ADR\/AQ-45\.md/);
  assert.doesNotMatch(text, /apiKey|pin|127\.0\.0\.1/i);
  // La nota de la base: ficha, enlace a la historia y sin la indicación técnica para Claude
  const note = (await store.readText(taskContextName(T1))) ?? '';
  assert.ok(note.startsWith('---\nhistoria: AQ-45\ntarea: AQ-101\ntags: [tipo/tarea]\n---\n'), note);
  assert.match(note, /Historia: \[\[AQ-45\]\]/);
  assert.match(note, /Pasa el test/);
  assert.doesNotMatch(note, /Nota de la historia|JM-ADR\/AQ-45\.md/);
});

test('el criterio de terminado no se repite si la descripción de Jira ya lo trae', () => {
  const input = {
    storyKey: STORY,
    issueKey: T1,
    title: 'Tarea',
    description: 'Hacer algo\n\n#### Criterio de terminado\n\n- Pasa el test',
    doneCriteria: ['Pasa el test'],
    logTail: '',
    noteHint: null,
    previous: [{ key: T2, title: 'Anterior' }],
  };
  assert.equal((renderTaskContext(input).match(/Criterio de terminado/g) ?? []).length, 1);
  assert.match(renderTaskContext(input, true), /- \[\[AQ-102\]\] · Anterior/);
  assert.match(renderTaskContext(input), /AQ-102 · Anterior \(su detalle está en tareas\/AQ-102\.md\)/);
});

test('terminar guarda finishedAt, pasa a Finalizada y no toca la estimación', async () => {
  const { ctx, calls, store } = await setup({ issues: ISSUES, transitions: { [T2]: DONE_TRANSITIONS } });
  await startTask(ctx, STORY, T2);
  const outcome = await finishTask(ctx, STORY, T2);
  assert.equal(outcome.kind, 'ok');
  assert.deepEqual(calls.transitions, [{ key: T2, id: '31' }]);
  const run = (await readState(store, STORY))?.taskRuns[T2];
  assert.equal(run?.status, 'done');
  assert.equal(run?.finishedAt, FIXED_NOW.toISOString());
  assert.equal(run?.pendingDone, undefined);
});

test('Jira caído al terminar deja el cierre pendiente y r lo reintenta', async () => {
  const issues = ISSUES;
  const down = await setup({ issues, transitions: { [T2]: DONE_TRANSITIONS }, down: true });
  await startTask({ ...down.ctx, jira: fakeJira({ issues }).jira }, STORY, T2);
  const failed = await finishTask(down.ctx, STORY, T2);
  assert.equal(failed.kind, 'failed');
  assert.equal((await readState(down.store, STORY))?.taskRuns[T2].pendingDone, true);

  const up = fakeJira({ issues, transitions: { [T2]: DONE_TRANSITIONS } });
  const retried = await retryPending({ ...down.ctx, jira: up.jira }, STORY);
  assert.deepEqual(retried, { finished: [T2], failed: [] });
  assert.equal((await readState(down.store, STORY))?.taskRuns[T2].status, 'done');
});

test('sin transición a Finalizada no queda un cierre pendiente que r aplique solo', async () => {
  const { ctx, store } = await setup({ issues: ISSUES, transitions: { [T2]: [] } });
  await startTask({ ...ctx, jira: fakeJira({ issues: ISSUES }).jira }, STORY, T2);
  const outcome = await finishTask(ctx, STORY, T2);
  assert.notEqual(outcome.kind, 'ok');
  const run = (await readState(store, STORY))?.taskRuns[T2];
  assert.equal(run?.pendingDone, undefined);
  assert.equal(run?.finishedAt, null);
  assert.deepEqual(await retryPending(ctx, STORY), { finished: [], failed: [] });
});

test('finalizar directo registra finishedDirect sin inicio ni tiempo y no toca la estimación', async () => {
  const { ctx, calls, store } = await setup({ issues: ISSUES, transitions: { [T1]: DONE_TRANSITIONS } });
  const outcome = await finishTask(ctx, STORY, T1, { direct: true });
  assert.equal(outcome.kind, 'ok');
  assert.deepEqual(calls.transitions, [{ key: T1, id: '31' }]);
  const run = (await readState(store, STORY))?.taskRuns[T1];
  assert.equal(run?.status, 'done');
  assert.equal(run?.startedAt, null);
  assert.equal(run?.finishedAt, FIXED_NOW.toISOString());
  assert.equal(run?.activeMs, 0);
  assert.equal(run?.finishedDirect, true);
  assert.equal(run?.pendingDone, undefined);
});

test('finalizar directo sin transición a Finalizada ofrece las disponibles y no deja rastro hasta elegir', async () => {
  const { ctx, calls, store } = await setup({
    issues: ISSUES,
    transitions: { [T1]: [{ id: '12', name: 'Backlog', to: { name: 'Backlog' } }] },
  });
  assert.deepEqual(await finishTask(ctx, STORY, T1, { direct: true }), { kind: 'choose', available: ['Backlog'] });
  assert.deepEqual((await readState(store, STORY))?.taskRuns, {});
  assert.equal((await finishTask(ctx, STORY, T1, { direct: true, transitionName: 'Backlog' })).kind, 'ok');
  assert.deepEqual(calls.transitions, [{ key: T1, id: '12' }]);
  assert.equal((await readState(store, STORY))?.taskRuns[T1].finishedDirect, true);
});

test('finalizar directo una tarea ya iniciada en jm conserva su tiempo medido', async () => {
  const { ctx, store } = await setup({ issues: ISSUES, transitions: { [T2]: DONE_TRANSITIONS } });
  await startTask(ctx, STORY, T2);
  await finishTask(ctx, STORY, T2, { direct: true });
  const run = (await readState(store, STORY))?.taskRuns[T2];
  assert.equal(run?.startedAt, FIXED_NOW.toISOString());
  assert.equal(run?.finishedDirect, undefined);
});

test('borrar: finalizadas y en curso se bloquean, las demás se borran y el registro se limpia', async () => {
  const issues = { ...ISSUES, [T1]: { ...ISSUES[T1], status: 'Finalizada', category: 'done' as const } };
  const { ctx, calls, store } = await setup({ issues });
  const results = await deleteTasks(ctx, STORY, [T1, T2, EXTRA]);
  assert.deepEqual(
    results.map((r) => r.ok),
    [false, false, true],
  );
  assert.match(results[0].message ?? '', /finalizada/);
  assert.match(results[1].message ?? '', /en curso/);
  assert.deepEqual(calls.deleted, [EXTRA]);
  assert.deepEqual((await readState(store, STORY))?.createdIssues, { T1, T2 });
});

test('devolver aplica la transición elegida y después la tarea se puede borrar', async () => {
  const { ctx, calls, store } = await setup({ issues: ISSUES, transitions: { [T2]: [START_TRANSITIONS[1]] } });
  assert.deepEqual(await returnOptions(ctx.jira, T2), ['Backlog']);
  await returnTo(ctx.jira, T2, 'Backlog');
  assert.deepEqual(calls.transitions, [{ key: T2, id: '12' }]);
  const back = fakeJira({ issues: { ...ISSUES, [T2]: { ...ISSUES[T2], status: 'Backlog', category: 'new' } } });
  const [result] = await deleteTasks({ ...ctx, jira: back.jira }, STORY, [T2]);
  assert.equal(result.ok, true);
  assert.deepEqual((await readState(store, STORY))?.createdIssues, { T1 });
});

test('devolver solo aplica a tareas en curso', async () => {
  const { ctx } = await setup({ issues: ISSUES });
  await assert.rejects(returnOptions(ctx.jira, T1), /no está en curso/);
});

test('un 403 en una tarea no detiene el borrado de las demás', async () => {
  const issues = { ...ISSUES, [T2]: { ...ISSUES[T2], status: 'Por hacer', category: 'new' as const } };
  const { ctx, calls, store } = await setup({ issues, denyDelete: [T1] });
  const results = await deleteTasks(ctx, STORY, [T1, T2, EXTRA]);
  assert.deepEqual(
    results.map((r) => r.ok),
    [false, true, true],
  );
  assert.match(results[0].message ?? '', /Permission denied/);
  assert.deepEqual(calls.deleted, [T2, EXTRA]);
  assert.deepEqual((await readState(store, STORY))?.createdIssues, { T1 });
});

test('no borra subtareas de otra historia', async () => {
  const issues = { ...ISSUES, [EXTRA]: { ...ISSUES[EXTRA], parent: 'AQ-99' } };
  const { ctx, calls } = await setup({ issues });
  const [result] = await deleteTasks(ctx, STORY, [EXTRA]);
  assert.equal(result.ok, false);
  assert.deepEqual(calls.deleted, []);
});

test('Mi día suma horas, marca las vencidas y consulta lo asignado al dev', async () => {
  const issues: Record<string, FakeIssue> = {
    [T1]: { status: 'Por hacer', category: 'new', estimate: 7200, due: '2026-11-04', parent: STORY },
    [T2]: { status: 'En curso', category: 'indeterminate', estimate: 3600, due: '2026-11-05' },
  };
  const { jira, calls } = fakeJira({ issues });
  const model = await loadMyDay(jira, FIXED_NOW);
  assert.equal(model.totalSeconds, 10800);
  assert.deepEqual(
    model.rows.map((r) => r.overdue),
    [true, false],
  );
  assert.match(calls.searches[0], /currentUser\(\)/);
  assert.equal(categoryOf(toIssue(T1, issues[T1])), 'new');
});

const CUSTOM_START: JiraTransition[] = [
  { id: '21', name: 'Arrancar', to: { name: 'Desarrollo', statusCategory: { key: 'indeterminate' } } },
  { id: '22', name: 'Backlog', to: { name: 'Backlog', statusCategory: { key: 'new' } } },
];
const TWO_ACTIVE: JiraTransition[] = [
  { id: '21', name: 'Arrancar', to: { name: 'Desarrollo', statusCategory: { key: 'indeterminate' } } },
  { id: '23', name: 'Revisar', to: { name: 'Revisión', statusCategory: { key: 'indeterminate' } } },
  { id: '22', name: 'Backlog', to: { name: 'Backlog', statusCategory: { key: 'new' } } },
];

test('si ningún nombre coincide, una única transición de la categoría En curso se aplica sola', async () => {
  const { ctx, calls } = await setup({ issues: ISSUES, transitions: { [T1]: CUSTOM_START } });
  assert.deepEqual(await startTask(ctx, STORY, T1), { kind: 'ok', storyKey: STORY });
  assert.deepEqual(calls.transitions, [{ key: T1, id: '21' }]);
});

test('con varias candidatas de la categoría se pregunta solo entre ellas', async () => {
  const { ctx, calls } = await setup({ issues: ISSUES, transitions: { [T1]: TWO_ACTIVE } });
  assert.deepEqual(await startTask(ctx, STORY, T1), { kind: 'choose', available: ['Arrancar', 'Revisar'] });
  assert.equal(calls.transitions.length, 0);
});

test('sin categoría que coincida se ofrecen todas las transiciones', async () => {
  const { ctx } = await setup({
    issues: ISSUES,
    transitions: {
      [T1]: [
        { id: '1', name: 'X' },
        { id: '2', name: 'Y' },
      ],
    },
  });
  assert.deepEqual(await startTask(ctx, STORY, T1), { kind: 'choose', available: ['X', 'Y'] });
});

test('la elección del dev se recuerda por proyecto y se usa la próxima vez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-trans-'));
  const memory = createFileTransitionMemory(dir);
  const { ctx, calls } = await setup({ issues: ISSUES, transitions: { [T1]: TWO_ACTIVE } });
  const withMemory = { ...ctx, transitionMemory: memory };
  assert.equal((await startTask(withMemory, STORY, T1, { transitionName: 'Revisar' })).kind, 'ok');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'transiciones.json'), 'utf8'));
  assert.deepEqual(stored, { AQ: { start: 'Revisar' } });
  assert.equal(
    (await startTask({ ...withMemory, transitionMemory: createFileTransitionMemory(dir) }, STORY, T1)).kind,
    'ok',
  );
  assert.deepEqual(calls.transitions, [
    { key: T1, id: '23' },
    { key: T1, id: '23' },
  ]);
});

test('la memoria ignora entradas inválidas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-trans-'));
  fs.writeFileSync(
    path.join(dir, 'transiciones.json'),
    JSON.stringify({ 'bad key': { start: 'X' }, AQ: { start: 5, done: 'Cerrar' } }),
  );
  const memory: TransitionMemory = createFileTransitionMemory(dir);
  assert.equal(memory.get('AQ', 'start'), undefined);
  assert.equal(memory.get('AQ', 'done'), 'Cerrar');
});
