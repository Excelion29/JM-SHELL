import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JiraIssue } from '../config/types';
import { renderTasksSection } from './note-links';
import {
  createPlanning,
  DEFAULT_PLANNING_SECONDS,
  openPlanningOf,
  planningGroupOf,
  planningSummary,
  suggestPlanning,
  type PlanningDeps,
} from './planning';
import { readState } from './state';
import { createFakeJira, storeAt, tempRoot, type FakeIssueSpec } from './test-support';
import type { StoryState, TaskRun } from './types';

const STORY = 'AQ-45';
const NOW = new Date('2026-11-09T15:00:00.000Z');
const TODAY = '2026-11-09';
const HOUR_MS = 3600 * 1000;

// Jira de creación + transiciones: la subtarea nueva nace "Por hacer" y se puede pasar a "En curso"
function planningJira(story: FakeIssueSpec | null = {}, transitions = true) {
  const fake = createFakeJira({ issues: story ? { [STORY]: story } : {} });
  const moved: string[] = [];
  const newIssue = (key: string): JiraIssue =>
    ({
      id: key,
      key,
      fields: {
        summary: 'Planificación',
        status: { name: 'Por hacer', statusCategory: { key: 'new' } },
        issuetype: { name: 'Subtarea' },
      },
    }) as JiraIssue;
  const jira: PlanningDeps['jira'] = {
    ...fake.jira,
    getIssue: async (key) => (key === STORY ? fake.jira.getIssue(key) : newIssue(key)),
    getIssueWithDescription: async (key) => newIssue(key),
    getTransitions: async () => (transitions ? [{ id: '11', name: 'Iniciar', to: { name: 'En curso' } }] : []),
    doTransition: async (key) => {
      moved.push(key);
    },
    searchIssues: async () => [],
    deleteIssue: async () => undefined,
  };
  return { jira, created: fake.calls.created, moved };
}

async function deps(jira: PlanningDeps['jira']): Promise<PlanningDeps> {
  return { jira, store: storeAt(await tempRoot(), STORY), assigneeId: 'acc-1', now: () => NOW };
}

const run = (issueKey: string, patch: Partial<TaskRun> = {}): TaskRun => ({
  issueKey,
  claudeSessionId: null,
  startedAt: '2026-11-09T08:00:00.000Z',
  finishedAt: '2026-11-09T09:30:00.000Z',
  activeMs: 0,
  status: 'done',
  ...patch,
});

const state = (patch: Partial<StoryState>): StoryState => ({
  key: STORY,
  summary: 'Login',
  phase: 'debate',
  block: null,
  claudeSessionId: null,
  parentKey: null,
  createdIssues: {},
  taskRuns: {},
  attachments: [],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 },
  updatedAt: NOW.toISOString(),
  ...patch,
});

const planning = (issueKey: string) => ({ issueKey, estimateSeconds: 3600, createdAt: NOW.toISOString() });

test('primera vez: crea la historia en jm, la Planificación en Jira y la deja En curso sin mover la fase', async () => {
  const { jira, created, moved } = planningJira({ epic: { key: 'AQ-1', summary: 'Épica' } });
  const d = await deps(jira);
  const outcome = await createPlanning(d, STORY, { estimate: '1h30m', dueDate: 'hoy' });
  assert.deepEqual(outcome, { ok: true, issueKey: 'AQ-101', started: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].summary, planningSummary(TODAY));
  assert.equal(created[0].estimateSeconds, 5400);
  assert.equal(created[0].dueDate, TODAY);
  assert.equal(created[0].parentKey, STORY);
  assert.equal(created[0].issueTypeName, 'Subtarea');
  assert.deepEqual(moved, ['AQ-101']);
  const saved = await readState(d.store, STORY);
  assert.equal(saved?.parentKey, 'AQ-1');
  assert.notEqual(saved?.phase, 'in-progress', 'la Planificación no adelanta la fase de la historia');
  assert.deepEqual(saved?.planningTasks, [{ ...planning('AQ-101'), estimateSeconds: 5400 }]);
  assert.equal(saved?.taskRuns['AQ-101']?.status, 'started');
  assert.equal(openPlanningOf(saved ?? null), 'AQ-101');
});

test('sin transición a En curso se crea igual y su tiempo corre en jm', async () => {
  const { jira } = planningJira({}, false);
  const d = await deps(jira);
  const outcome = await createPlanning(d, STORY, { estimate: '1h', dueDate: '' });
  assert.deepEqual(outcome, { ok: true, issueKey: 'AQ-101', started: false });
  assert.equal((await readState(d.store, STORY))?.taskRuns['AQ-101']?.status, 'started');
});

test('la fecha editada por el dev llega a Jira (relativa o ISO)', async () => {
  for (const [dueDate, expected] of [
    ['+2', '2026-11-11'],
    ['2026-11-20', '2026-11-20'],
  ] as const) {
    const { jira, created } = planningJira();
    await createPlanning(await deps(jira), STORY, { estimate: '1h', dueDate });
    assert.equal(created[0].dueDate, expected);
  }
});

test('creada en Jira pero sin poder registrarla en jm: avisa con su clave para finalizarla desde Jira', async () => {
  const { jira } = planningJira();
  const d = await deps(jira);
  let createdInJira = false;
  const createIssue = jira.createIssue;
  jira.createIssue = async (input) => {
    const result = await createIssue(input);
    createdInJira = true;
    return result;
  };
  const writeText = d.store.writeText;
  d.store = {
    ...d.store,
    writeText: async (name, content) => {
      if (createdInJira) throw new Error('disco lleno');
      return writeText(name, content);
    },
  };
  const outcome = await createPlanning(d, STORY, { estimate: '1h', dueDate: 'hoy' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? '' : outcome.message, /Creé AQ-101 en Jira.*disco lleno/);
});

test('una clave inesperada de Jira no se registra y se avisa', async () => {
  const { jira } = planningJira();
  const d = await deps(jira);
  const createIssue = jira.createIssue;
  jira.createIssue = async (input) => ({ ...(await createIssue(input)), key: '../AQ-101' });
  const outcome = await createPlanning(d, STORY, { estimate: '1h', dueDate: 'hoy' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? '' : outcome.message, /clave inesperada/);
  assert.equal((await readState(d.store, STORY))?.planningTasks, undefined);
});

test('errores: estimación inválida, historia finalizada o inexistente; nada se crea', async () => {
  for (const [story, input, pattern] of [
    [{}, { estimate: '3 horas', dueDate: 'hoy' }, /Planificación/],
    [{ status: 'done' as const }, { estimate: '1h', dueDate: 'hoy' }, /ya está finalizada/],
    [null, { estimate: '1h', dueDate: 'hoy' }, /no encontré la historia/],
  ] as const) {
    const { jira, created } = planningJira(story);
    const outcome = await createPlanning(await deps(jira), STORY, input);
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? '' : outcome.message, pattern);
    assert.equal(created.length, 0);
  }
});

test('openPlanningOf: la abierta más reciente; las finalizadas no cuentan', () => {
  assert.equal(openPlanningOf(null), null);
  const done = state({ planningTasks: [planning('AQ-101')], taskRuns: { 'AQ-101': run('AQ-101') } });
  assert.equal(openPlanningOf(done), null);
  const open = state({
    planningTasks: [planning('AQ-101'), planning('AQ-102')],
    taskRuns: { 'AQ-101': run('AQ-101'), 'AQ-102': run('AQ-102', { status: 'started', finishedAt: null }) },
  });
  assert.equal(openPlanningOf(open), 'AQ-102');
});

test('sugerencia: 1h sin medidas; con medidas, el promedio de inicio a fin redondeado a 5 min', () => {
  assert.deepEqual(suggestPlanning(planningGroupOf([])), { estimate: '1h', dueDate: 'hoy', measured: 0 });
  assert.equal(DEFAULT_PLANNING_SECONDS, 3600);
  const measured = state({
    planningTasks: [planning('AQ-101'), planning('AQ-102'), planning('AQ-103')],
    taskRuns: {
      'AQ-101': run('AQ-101'),
      'AQ-102': run('AQ-102', { finishedAt: '2026-11-09T10:00:00.000Z', priorElapsedMs: HOUR_MS / 2 }),
      // Abierta: no cuenta
      'AQ-103': run('AQ-103', { status: 'started', finishedAt: null }),
    },
  });
  const group = planningGroupOf([measured]);
  // 1h30m y 2h30m: promedio 2h
  assert.deepEqual(group, { count: 2, estimateSeconds: 7200, elapsedSeconds: 4 * 3600 });
  assert.deepEqual(suggestPlanning(group), { estimate: '2h', dueDate: 'hoy', measured: 2 });
});

test('la nota de la historia lista las Planificaciones con su estado', () => {
  const section = renderTasksSection(
    state({ planningTasks: [planning('AQ-101')], taskRuns: { 'AQ-101': run('AQ-101', { status: 'started' }) } }),
    null,
    new Set(),
  );
  assert.match(section, /^- AQ-101 · Planificación · en curso$/m);
});
