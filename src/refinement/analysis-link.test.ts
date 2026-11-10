import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JiraIssue } from '../config/types';
import { ANALYSIS_POINTS_FILE, ANALYSIS_STATE_FILE, createAnalysis, readAnalysis, updateAnalysis } from './analysis';
import {
  createLinkedPoints,
  finishLinked,
  type LinkDeps,
  linkedAnalysesOf,
  linkedIssueOf,
  noticeOf,
  pointDescription,
  resolveLinkTarget,
  setAnalysisEpic,
  startLinked,
  syncLinkedPoints,
} from './analysis-link';
import { finishPoint, startPoint } from './analysis-point-runs';
import { removeAnalysis } from './analysis-remove';
import { linkedAnalysisLine } from './knowledge';
import { createAnalysisProjectStore } from './project-store';
import { createFakeJira, type FakeIssueSpec, tempRoot } from './test-support';
import { workDirFor } from './workdir';

const ID = 'an-1';
const TODAY = '2026-11-10';
const EPIC = 'AQ-5';
const STORY_A = 'AQ-20';
const STORY_B = 'AQ-21';
const SUBTASK = 'AQ-30';
const OTHER_PROJECT_EPIC = 'ZZ-1';
const START_TRANSITION = '11';
const DONE_TRANSITION = '12';

const ISSUES: Record<string, FakeIssueSpec> = {
  [EPIC]: { type: 'Epic' },
  [STORY_A]: { epic: { key: EPIC, summary: 'Épica' } },
  [STORY_B]: { epic: { key: EPIC, summary: 'Épica' } },
  [SUBTASK]: { type: 'Subtarea' },
  [OTHER_PROJECT_EPIC]: { type: 'Epic' },
};

const rawPoint = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  title: `Título ${id}`,
  analysis: 'Analisis del punto',
  proposal: 'Propuesta del punto',
  outOfScope: false,
  estimate: { optimistic: '1h', likely: '1h', pessimistic: '1h' },
  risk: 'low',
  ...patch,
});

type Workflow = 'full' | 'none' | 'twostep' | 'unknown';

const transition = (id: string, name: string, to: string, category: string) => ({
  id,
  name,
  to: { name: to, statusCategory: { key: category } },
});
const START = transition(START_TRANSITION, 'Iniciar', 'En curso', 'indeterminate');
const FINISH = transition(DONE_TRANSITION, 'Finalizar', 'Finalizada', 'done');
const CLOSED = transition('31', 'Hecho', 'Cerrado', 'done');
const DISCARDED = transition('32', 'Descartar', 'Descartado', 'done');
const CATEGORY_OF_TRANSITION: Record<string, string> = { '11': 'indeterminate', '12': 'done', '31': 'done', '32': 'done' };

// Jira de creación + transiciones: lo recién creado nace "Por hacer" y cada transición cambia su categoría
//   full: iniciar y finalizar disponibles desde cualquier estado · twostep: de "Por hacer" solo se puede iniciar
//   unknown: dos estados finales con nombres que jm no conoce · none: ninguna transición
function linkJira(options: { failCreateAt?: number; workflow?: Workflow; categories?: Record<string, string> } = {}) {
  const workflow = options.workflow ?? 'full';
  const fake = createFakeJira({ issues: ISSUES, failCreateAt: options.failCreateAt });
  const moved: Array<{ key: string; transitionId: string }> = [];
  const categories = new Map(Object.entries(options.categories ?? {}));
  const fresh = (key: string): JiraIssue =>
    ({
      id: key,
      key,
      fields: {
        summary: 'Punto',
        status: { name: 'x', statusCategory: { key: categories.get(key) ?? 'new' } },
        issuetype: { name: 'Subtarea' },
      },
    }) as JiraIssue;
  const offered = (key: string) => {
    const category = categories.get(key) ?? 'new';
    if (workflow === 'none') return [];
    if (workflow === 'unknown') return [CLOSED, DISCARDED];
    if (workflow === 'twostep') return category === 'new' ? [START] : [FINISH];
    return [START, FINISH];
  };
  const jira: LinkDeps['jira'] = {
    ...fake.jira,
    getIssue: async (key) => (key in ISSUES ? fake.jira.getIssue(key) : fresh(key)),
    getIssueWithDescription: async (key) => fresh(key),
    getTransitions: async (key) => offered(key),
    doTransition: async (key, transitionId) => {
      moved.push({ key, transitionId });
      categories.set(key, CATEGORY_OF_TRANSITION[transitionId]);
    },
    searchIssues: async () => [],
    deleteIssue: async () => undefined,
  };
  return { jira, created: fake.calls.created, moved };
}

function memoryOf() {
  const values = new Map<string, string>();
  return {
    values,
    get: (project: string, target: string) => values.get(`${project}/${target}`),
    set: (project: string, target: string, name: string) => void values.set(`${project}/${target}`, name),
  };
}

async function setup(points: unknown[] = [rawPoint('P1'), rawPoint('P2'), rawPoint('P3'), rawPoint('P9', { outOfScope: true })]) {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, ID);
  await createAnalysis(store, ID, 'Observaciones', 'AQ');
  await store.writeText(ANALYSIS_POINTS_FILE, JSON.stringify({ points }));
  return { root, store };
}

const depsOf = (jira: LinkDeps['jira'], store: LinkDeps['store']): LinkDeps => ({
  jira,
  store,
  assigneeId: 'acc-1',
  today: TODAY,
});

test('todos los puntos a la épica crean tareas con estimación, fecha, responsable y descripción', async () => {
  const { store } = await setup();
  const { jira, created } = linkJira();
  const results = await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC, P2: EPIC });
  assert.deepEqual(
    results.map((r) => [r.pointId, r.ok, r.issueKey]),
    [
      ['P1', true, 'AQ-101'],
      ['P2', true, 'AQ-102'],
    ],
  );
  assert.equal(created[0].issueTypeName, 'Tarea');
  assert.equal(created[0].parentKey, EPIC);
  assert.equal(created[0].summary, 'Título P1');
  assert.equal(created[0].estimateSeconds, 3600);
  assert.equal(created[0].dueDate, TODAY);
  assert.equal(created[0].assigneeId, 'acc-1');
  assert.match(JSON.stringify(created[0].description), /Analisis del punto[\s\S]*Propuesta del punto/);
  const link = (await readAnalysis(store, ID))?.link;
  assert.deepEqual(link?.points, {
    P1: { issueKey: 'AQ-101', parentKey: EPIC },
    P2: { issueKey: 'AQ-102', parentKey: EPIC },
  });
});

test('puntos a dos historias distintas crean subtareas bajo cada una', async () => {
  const { store } = await setup();
  const { jira, created } = linkJira();
  await createLinkedPoints(depsOf(jira, store), ID, { P1: STORY_A, P2: STORY_B, P3: STORY_A });
  assert.deepEqual(
    created.map((c) => [c.issueTypeName, c.parentKey]),
    [
      ['Subtarea', STORY_A],
      ['Subtarea', STORY_B],
      ['Subtarea', STORY_A],
    ],
  );
});

test('un punto sin destino no se crea ni aparece en el resultado', async () => {
  const { store } = await setup();
  const { jira, created } = linkJira();
  const results = await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC });
  assert.deepEqual(results.map((r) => r.pointId), ['P1']);
  assert.equal(created.length, 1);
  assert.equal((await readAnalysis(store, ID))?.link?.points.P2, undefined);
});

test('repetir solo crea lo que falta y un punto ya creado no cambia de destino', async () => {
  const { store } = await setup();
  const first = linkJira();
  await createLinkedPoints(depsOf(first.jira, store), ID, { P1: EPIC });
  const second = linkJira();
  const results = await createLinkedPoints(depsOf(second.jira, store), ID, { P1: STORY_A, P2: EPIC });
  assert.deepEqual(results.map((r) => r.pointId), ['P2']);
  assert.equal(second.created.length, 1);
  assert.equal((await readAnalysis(store, ID))?.link?.points.P1.parentKey, EPIC);
});

test('cada punto se anota apenas se crea: un corte a medias no duplica al reintentar', async () => {
  const { store } = await setup();
  const failing = linkJira({ failCreateAt: 2 });
  const results = await createLinkedPoints(depsOf(failing.jira, store), ID, { P1: EPIC, P2: EPIC, P3: EPIC });
  assert.deepEqual(results.map((r) => r.ok), [true, false, false]);
  assert.match(results[1].message ?? '', /caído/);
  assert.deepEqual(Object.keys((await readAnalysis(store, ID))?.link?.points ?? {}), ['P1']);
  const retry = linkJira();
  const again = await createLinkedPoints(depsOf(retry.jira, store), ID, { P1: EPIC, P2: EPIC, P3: EPIC });
  assert.deepEqual(again.map((r) => r.pointId), ['P2', 'P3']);
  assert.deepEqual(retry.created.map((c) => c.summary), ['Título P2', 'Título P3']);
});

test('el estado del punto pasa a Jira: en curso y finalizado; sin transición se avisa sin bloquear', async () => {
  const { store } = await setup();
  await startPoint(store, ID, 'P1');
  await finishPoint(store, ID, 'P2');
  const { jira, moved } = linkJira();
  const results = await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC, P2: EPIC, P3: EPIC });
  assert.deepEqual(moved, [
    { key: 'AQ-101', transitionId: START_TRANSITION },
    { key: 'AQ-102', transitionId: DONE_TRANSITION },
  ]);
  assert.equal(results[0].message, undefined);

  const { store: other } = await setup([rawPoint('P1')]);
  await startPoint(other, ID, 'P1');
  const stuck = linkJira({ workflow: 'none' });
  const [result] = await createLinkedPoints(depsOf(stuck.jira, other), ID, { P1: EPIC });
  assert.equal(result.ok, true);
  assert.match(result.message ?? '', /No pude mover AQ-101/);
});

test('un destino subtarea, de otro proyecto o con clave inválida se rechaza sin crear nada', async () => {
  const { store } = await setup();
  const { jira, created } = linkJira();
  const results = await createLinkedPoints(depsOf(jira, store), ID, {
    P1: SUBTASK,
    P2: OTHER_PROJECT_EPIC,
    P3: 'xx',
  });
  assert.deepEqual(results.map((r) => r.ok), [false, false, false]);
  assert.match(results[0].message ?? '', /subtarea/);
  assert.match(results[1].message ?? '', /no es del proyecto AQ/);
  assert.match(results[2].message ?? '', /inválida/);
  assert.equal(created.length, 0);
});

test('la épica del análisis debe ser una épica del proyecto', async () => {
  const { jira } = linkJira();
  assert.equal((await resolveLinkTarget(jira, 'AQ', EPIC, true)).ok, true);
  const story = await resolveLinkTarget(jira, 'AQ', STORY_A, true);
  assert.equal(story.ok, false);
  assert.match(story.ok ? '' : story.message, /no es una épica/);
  const foreign = await resolveLinkTarget(jira, 'AQ', OTHER_PROJECT_EPIC, true);
  assert.match(foreign.ok ? '' : foreign.message, /no es del proyecto/);
});

test('guardar y quitar la épica; una clave inválida se rechaza', async () => {
  const { store } = await setup();
  await setAnalysisEpic(store, ID, EPIC);
  assert.equal((await readAnalysis(store, ID))?.link?.epicKey, EPIC);
  await setAnalysisEpic(store, ID, null);
  assert.equal((await readAnalysis(store, ID))?.link, undefined);
  await assert.rejects(() => setAnalysisEpic(store, ID, '../x'), /inválida/);
});

test('el vínculo se valida al leer: claves y ids inválidos se descartan', async () => {
  const { store } = await setup();
  const raw = JSON.parse((await store.readText(ANALYSIS_STATE_FILE)) as string);
  raw.link = {
    epicKey: '../etc',
    points: { P1: { issueKey: 'AQ-9', parentKey: EPIC }, x1: { issueKey: 'AQ-8', parentKey: EPIC }, P2: { issueKey: 'no', parentKey: EPIC } },
  };
  await store.writeText(ANALYSIS_STATE_FILE, JSON.stringify(raw));
  const link = (await readAnalysis(store, ID))?.link;
  assert.deepEqual(link, { epicKey: null, points: { P1: { issueKey: 'AQ-9', parentKey: EPIC } } });
});

test('iniciar y finalizar un punto vinculado mueve su tarea en Jira', async () => {
  const { store } = await setup();
  const { jira, moved } = linkJira();
  await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC });
  assert.equal(await linkedIssueOf(store, ID, 'P1'), 'AQ-101');
  assert.equal(await linkedIssueOf(store, ID, 'P2'), null);
  assert.deepEqual(await startLinked({ jira }, 'AQ-101'), { kind: 'ok', moved: true });
  assert.deepEqual(await finishLinked({ jira }, 'AQ-101'), { kind: 'ok', moved: true });
  assert.deepEqual(moved.map((m) => m.transitionId), [START_TRANSITION, DONE_TRANSITION]);
  const stuck = linkJira({ workflow: 'none' });
  assert.match(noticeOf(await startLinked({ jira: stuck.jira }, 'AQ-101'), 'AQ-101') ?? '', /AQ-101/);
});

test('la descripción acota el texto de Claude y quita secuencias de terminal', () => {
  const [point] = [rawPoint('P1', { analysis: `ok\u001b[31m${'x'.repeat(20000)}` })].map(
    (raw) => ({ ...raw, estimate: null, risk: 'low' }) as never,
  );
  const text = pointDescription(point);
  assert.equal(text.includes('\u001b'), false);
  assert.ok(text.length < 8300 * 2);
});

test('un análisis vinculado a Jira no se borra, ni por la épica ni por un punto', async () => {
  const { root, store } = await setup();
  await setAnalysisEpic(store, ID, EPIC);
  const blocked = await removeAnalysis(store, workDirFor(root), ID);
  assert.deepEqual(blocked, { ok: false, message: `${ID} está vinculado a Jira; no lo borro.` });
  await setAnalysisEpic(store, ID, null);
  const { jira } = linkJira();
  await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC });
  const again = await removeAnalysis(store, workDirFor(root), ID);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.message, /vinculado a Jira/);
});

test('el contexto de refinar incluye el análisis solo para historias de su épica', async () => {
  const { store } = await setup();
  await setAnalysisEpic(store, ID, EPIC);
  const state = await readAnalysis(store, ID);
  const states = state ? [state] : [];
  const refs = linkedAnalysesOf(states, EPIC);
  assert.deepEqual(refs, [{ id: ID, name: 'Observaciones' }]);
  assert.deepEqual(linkedAnalysesOf(states, 'AQ-6'), []);
  assert.deepEqual(linkedAnalysesOf(states, null), []);
  const line = linkedAnalysisLine(refs, (id) => `.jm/analisis/${id}`);
  assert.match(line, /an-1 \(Observaciones\) en `\.jm\/analisis\/an-1`/);
  assert.match(line, /análisis_propuesta\.md.*observaciones_funcional_tecnico\.md.*resumen_observaciones\.md.*puntos\.json/);
  assert.match(line, /no escribas ahí/);
  assert.equal(linkedAnalysisLine([], (id) => id), '');
});

test('si falla anotar una tarea recién creada se detiene: no crea más y avisa de no reintentar', async () => {
  const { store } = await setup();
  const { jira, created } = linkJira();
  const broken = Object.create(store) as typeof store;
  broken.writeText = async () => {
    throw new Error('disco lleno');
  };
  const results = await createLinkedPoints(depsOf(jira, broken), ID, { P1: EPIC, P2: EPIC, P3: EPIC });
  assert.equal(created.length, 1);
  assert.deepEqual(results.map((r) => r.ok), [true, false, false]);
  assert.match(results[0].message ?? '', /AQ-101.*No reintentes P1.*duplicaría/);
  assert.match(results[1].message ?? '', /No lo intenté/);
  assert.match(results[2].message ?? '', /No lo intenté/);
});

test('un análisis sin proyecto no crea nada', async () => {
  const { store } = await setup();
  const raw = JSON.parse((await store.readText(ANALYSIS_STATE_FILE)) as string);
  raw.projectKey = '';
  await store.writeText(ANALYSIS_STATE_FILE, JSON.stringify(raw));
  const { jira, created } = linkJira();
  const [result] = await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC });
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /no tiene proyecto/);
  assert.equal(created.length, 0);
});

test('las actualizaciones concurrentes del estado se encolan y no se pisan', async () => {
  const { store } = await setup();
  await Promise.all([
    ...['P1', 'P2', 'P3', 'P4'].map((pointId, n) =>
      updateAnalysis(store, ID, (state) => {
        state.link = { epicKey: null, points: { ...(state.link?.points ?? {}), [pointId]: { issueKey: `AQ-${n + 1}`, parentKey: EPIC } } };
      }),
    ),
    updateAnalysis(store, ID, (state) => {
      state.pointRuns.P1 = { issueKey: 'P1', claudeSessionId: null, startedAt: '2026-11-10T10:00:00.000Z', finishedAt: null, activeMs: 5, status: 'started' };
    }),
  ]);
  const state = await readAnalysis(store, ID);
  assert.deepEqual(Object.keys(state?.link?.points ?? {}), ['P1', 'P2', 'P3', 'P4']);
  assert.equal(state?.pointRuns.P1.activeMs, 5);
});

test('el nombre del análisis en el contexto se acota y no rompe las comillas', () => {
  const line = linkedAnalysisLine([{ id: ID, name: `a\`b${'x'.repeat(500)}` }], (id) => id);
  assert.equal(line.includes('a`b'), false);
  assert.ok(line.length < 900);
});

test('sin transición conocida el punto pide elegir; lo elegido se aplica, se recuerda y reintenta el resto', async () => {
  const { store } = await setup();
  await finishPoint(store, ID, 'P1');
  await finishPoint(store, ID, 'P2');
  const { jira, moved } = linkJira({ workflow: 'unknown' });
  const memory = memoryOf();
  const deps = { ...depsOf(jira, store), transitionMemory: memory };
  const created = await createLinkedPoints(deps, ID, { P1: EPIC, P2: EPIC });
  assert.deepEqual(created.map((r) => r.choose?.target), ['done', 'done']);
  assert.deepEqual(created[0].choose?.available, ['Hecho', 'Descartar']);
  assert.equal(moved.length, 0);
  const synced = await syncLinkedPoints(deps, ID, { target: 'done', name: 'Hecho' });
  assert.deepEqual(synced.map((r) => [r.pointId, r.choose, r.message]), [['P1', undefined, undefined], ['P2', undefined, undefined]]);
  assert.deepEqual(moved.map((m) => m.transitionId), ['31', '31']);
  assert.equal(memory.values.get('AQ/done'), 'Hecho');
});

test('si desde "Por hacer" no hay transición a Finalizada se inicia y luego se finaliza', async () => {
  const { store } = await setup();
  await finishPoint(store, ID, 'P1');
  const { jira, moved } = linkJira({ workflow: 'twostep' });
  const [result] = await createLinkedPoints(depsOf(jira, store), ID, { P1: EPIC });
  assert.deepEqual([result.ok, result.choose, result.message], [true, undefined, undefined]);
  assert.deepEqual(moved.map((m) => m.transitionId), [START_TRANSITION, DONE_TRANSITION]);
});

test('sincronizar puntos ya vinculados corrige solo los que difieren de Jira', async () => {
  const { store } = await setup();
  const first = linkJira({ workflow: 'none' });
  await startPoint(store, ID, 'P1');
  await finishPoint(store, ID, 'P2');
  await createLinkedPoints(depsOf(first.jira, store), ID, { P1: EPIC, P2: EPIC, P3: EPIC });
  const { jira, moved } = linkJira({ categories: { 'AQ-101': 'indeterminate' } });
  const results = await syncLinkedPoints(depsOf(jira, store), ID);
  assert.deepEqual(results.map((r) => [r.pointId, r.issueKey, r.choose, r.message]), [['P2', 'AQ-102', undefined, undefined]]);
  assert.deepEqual(moved, [{ key: 'AQ-102', transitionId: DONE_TRANSITION }]);
  assert.deepEqual(await syncLinkedPoints(depsOf(jira, store), ID), []);
});
