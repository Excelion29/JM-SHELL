import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { JiraIssue } from '../config/types';
import { IssueNotFoundError } from '../services/jira';
import {
  analysisSummary,
  analysisTrackingSummary,
  createAnalysis,
  filterAnalysesByProject,
  listAnalysesFrom,
  isValidAnalysisId,
  nextAnalysisId,
  openTrackingOf,
  readAnalysis,
} from './analysis';
import { addSources, NOTHING_TO_ADD, parsePathList, TEXT_SOURCE_FILE } from './analysis-sources';
import { createAnalysisTracking, finishAnalysisTask, type AnalysisTrackingDeps } from './analysis-tracking';
import { MAX_ATTACHMENT_BYTES } from './attachments';
import { planningGroupOf, suggestPlanning } from './planning';
import { createAnalysisProjectStore } from './project-store';
import { createFakeJira, tempRoot, type FakeIssueSpec } from './test-support';

const ID = 'an-1';
const PROJECT = 'AQ';
const NOW = new Date('2026-11-09T15:00:00.000Z');
const TODAY = '2026-11-09';
const EPIC = 'AQ-5';
const MANAGEMENT_STORY = 'AQ-7';
const MISSING = 'AQ-99';

async function newAnalysis(name = 'MineTrack observaciones') {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, ID);
  await createAnalysis(store, ID, name, PROJECT, NOW);
  return { root, store };
}

async function sourceFile(dir: string, name: string, content: string | Buffer = 'contenido'): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, content);
  return file;
}

test('ids: formato an-<n> en minúsculas, distinto de una clave de Jira; el siguiente es el mayor + 1', () => {
  assert.equal(isValidAnalysisId('an-1'), true);
  assert.equal(isValidAnalysisId('an-123456'), true);
  for (const bad of ['AN-1', 'an-', 'an-1234567', 'an-1a', 'AQ-45', '../an-1', 'an-1/x', '']) {
    assert.equal(isValidAnalysisId(bad), false, bad);
  }
  assert.equal(nextAnalysisId([]), 'an-1');
  assert.equal(nextAnalysisId(['an-1', 'an-3', 'an-2']), 'an-4');
  assert.equal(nextAnalysisId(['an-2', 'basura', 'AQ-45']), 'an-3', 'lo que no es un id se ignora');
});

test('crear: estado con id, nombre y proyecto; bitácora inicial; sin nombre se rechaza', async () => {
  const { store } = await newAnalysis('  Observaciones  ');
  const state = await readAnalysis(store, ID);
  assert.equal(state?.name, 'Observaciones');
  assert.equal(state?.projectKey, PROJECT);
  assert.equal(state?.phase, 'sources');
  assert.deepEqual(state?.sources, []);
  assert.equal(await store.readText('bitacora.md'), '# Bitácora Observaciones\n\n');
  await assert.rejects(createAnalysis(store, ID, '   ', PROJECT), /nombre/);
  await assert.rejects(createAnalysis(store, 'AQ-45', 'x', PROJECT), /inválido/);
});

test('listado: el resumen lleva la marca de análisis y se filtra por el proyecto guardado', async () => {
  const { store } = await newAnalysis();
  const other = createAnalysisProjectStore(await tempRoot(), 'an-2');
  await createAnalysis(other, 'an-2', 'Otro', 'ZZ', NOW);
  const states = [(await readAnalysis(store, ID))!, (await readAnalysis(other, 'an-2'))!];
  assert.deepEqual(
    filterAnalysesByProject(states, PROJECT).map((s) => s.id),
    [ID],
  );
  assert.equal(filterAnalysesByProject(states, null).length, 2);
  const summary = analysisSummary(states[0]);
  assert.equal(summary.kind, 'analysis');
  assert.equal(summary.key, ID);
  assert.equal(summary.summary, 'MineTrack observaciones');
});

test('rutas: coma, punto y coma y saltos de línea separan; las comillas conservan espacios y comas', () => {
  assert.deepEqual(parsePathList('C:\\a\\x.md, C:\\a\\y.txt;C:\\a\\z.pdf\nC:\\a\\w.eml'), [
    'C:\\a\\x.md',
    'C:\\a\\y.txt',
    'C:\\a\\z.pdf',
    'C:\\a\\w.eml',
  ]);
  assert.deepEqual(parsePathList('"C:\\mis docs\\a, b.md", \'C:\\otra carpeta\\c.txt\''), [
    'C:\\mis docs\\a, b.md',
    'C:\\otra carpeta\\c.txt',
  ]);
  assert.deepEqual(parsePathList('  ;; , '), []);
});

test('fuentes: copia las válidas a fuentes/, rechaza las demás con su motivo y registra solo lo copiado', async () => {
  const { store } = await newAnalysis();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-src-'));
  const ok = await sourceFile(dir, 'nota.md', '# nota');
  const image = await sourceFile(dir, 'captura.PNG', Buffer.from([1, 2, 3]));
  const exe = await sourceFile(dir, 'virus.exe');
  const folder = path.join(dir, 'carpeta.md');
  await fs.ensureDir(folder);
  const big = path.join(dir, 'grande.pdf');
  await fs.writeFile(big, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
  const missing = path.join(dir, 'no-existe.txt');
  const results = await addSources(store, ID, {
    paths: [ok, image, exe, folder, big, missing, 'relativa.md'].join(';'),
    text: '',
  });
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, false, false, false, false, false],
  );
  const failures = results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.message));
  assert.match(failures[0], /tipo no admitido/);
  assert.match(failures[1], /no es un archivo/);
  assert.match(failures[2], /pesa más de 20 MB/);
  assert.match(failures[3], /no encontré/);
  assert.match(failures[4], /absoluta/);
  assert.equal(await store.readText('fuentes/nota.md'), '# nota');
  assert.ok((await store.readBinary('fuentes/captura.PNG', MAX_ATTACHMENT_BYTES))?.equals(Buffer.from([1, 2, 3])));
  assert.equal(await store.exists('fuentes/virus.exe'), false);
  const state = await readAnalysis(store, ID);
  assert.deepEqual(
    state?.sources.map((s) => [s.file, s.origin]),
    [
      ['nota.md', 'file'],
      ['captura.PNG', 'file'],
    ],
  );
});

test('fuentes: ruta entre comillas con espacios y nombres repetidos sin pisarse', async () => {
  const { store } = await newAnalysis();
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'jm src a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'jm src b-'));
  const a = await sourceFile(dirA, 'mi nota.md', 'A');
  const b = await sourceFile(dirB, 'mi nota.md', 'B');
  const results = await addSources(store, ID, { paths: `"${a}", "${b}"`, text: '' });
  assert.deepEqual(
    results.map((r) => r.ok && r.file),
    ['mi nota.md', 'mi nota-2.md'],
  );
  assert.equal(await store.readText('fuentes/mi nota.md'), 'A');
  assert.equal(await store.readText('fuentes/mi nota-2.md'), 'B');
  // Más tarde, otra con el mismo nombre sigue sin pisar
  const later = await addSources(store, ID, { paths: a, text: '' });
  assert.equal(later[0].ok && later[0].file, 'mi nota-3.md');
});

test('fuentes: el texto pegado va a fuentes/texto.md y los siguientes se agregan al final; un archivo texto.md no lo pisa', async () => {
  const { store } = await newAnalysis();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-src-'));
  const own = await sourceFile(dir, 'texto.md', 'del archivo');
  await addSources(store, ID, { paths: own, text: 'primero' });
  await addSources(store, ID, { paths: '', text: 'segundo' });
  assert.equal(await store.readText('fuentes/texto-2.md'), 'del archivo');
  const pasted = (await store.readText(`fuentes/${TEXT_SOURCE_FILE}`)) ?? '';
  assert.ok(pasted.startsWith('primero') && pasted.endsWith('segundo\n'));
  const state = await readAnalysis(store, ID);
  assert.equal(state?.sources.filter((s) => s.origin === 'text').length, 1, 'el texto se registra una sola vez');
});

test('fuentes: sin rutas ni texto se avisa; un enlace simbólico no se sigue', async (t) => {
  const { store } = await newAnalysis();
  await assert.rejects(addSources(store, ID, { paths: ' ', text: ' ' }), new RegExp(NOTHING_TO_ADD));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-src-'));
  const target = await sourceFile(dir, 'real.md');
  const link = path.join(dir, 'enlace.md');
  try {
    await fs.symlink(target, link);
  } catch {
    t.skip('esta plataforma no permite crear enlaces simbólicos sin privilegios');
    return;
  }
  const results = await addSources(store, ID, { paths: link, text: '' });
  assert.equal(results[0].ok, false);
  assert.equal(await store.exists('fuentes/enlace.md'), false);
});

// Jira mínimo: la tarea nueva nace "Por hacer" y se puede pasar a "En curso" o "Finalizada"
function trackingJira(others: Record<string, FakeIssueSpec> = {}) {
  const fake = createFakeJira({ issues: others });
  const moved: string[] = [];
  const newIssue = (key: string): JiraIssue =>
    ({
      id: key,
      key,
      fields: {
        summary: 'Análisis',
        status: { name: 'Por hacer', statusCategory: { key: 'new' } },
        issuetype: { name: 'Tarea' },
      },
    }) as JiraIssue;
  const jira: AnalysisTrackingDeps['jira'] = {
    ...fake.jira,
    getIssue: async (key) => {
      if (key === MISSING) throw new IssueNotFoundError(`Resource not found: ${key}`);
      return key in others ? fake.jira.getIssue(key) : newIssue(key);
    },
    getIssueWithDescription: async (key) => newIssue(key),
    getTransitions: async () => [
      { id: '11', name: 'Iniciar', to: { name: 'En curso', statusCategory: { key: 'indeterminate' } } },
      { id: '31', name: 'Terminar', to: { name: 'Finalizada', statusCategory: { key: 'done' } } },
    ],
    doTransition: async (key, id) => {
      moved.push(`${key}:${id}`);
    },
    searchIssues: async () => [],
    deleteIssue: async () => undefined,
  };
  return { jira, created: fake.calls.created, moved };
}

async function trackingDeps(jira: AnalysisTrackingDeps['jira'], management: string | null) {
  const { store } = await newAnalysis('Observaciones MineTrack');
  const deps: AnalysisTrackingDeps = { jira, store, assigneeId: 'acc-1', management, now: () => NOW };
  return deps;
}

const INPUT = { estimate: '1h30m', dueDate: 'hoy' };

test('con épica de gestión: tarea hija en la épica con el título del análisis, En curso y registrada en el análisis', async () => {
  const { jira, created, moved } = trackingJira({ [EPIC]: { type: 'Epic' } });
  const deps = await trackingDeps(jira, EPIC);
  const outcome = await createAnalysisTracking(deps, ID, INPUT, null);
  assert.deepEqual(outcome, { ok: true, issueKey: 'AQ-101', started: true });
  assert.equal(created[0].parentKey, EPIC);
  assert.equal(created[0].issueTypeName, 'Tarea');
  assert.equal(created[0].summary, analysisTrackingSummary('Observaciones MineTrack', TODAY));
  assert.equal(created[0].summary, 'Análisis · Observaciones MineTrack · 2026-11-09');
  assert.equal(created[0].estimateSeconds, 5400);
  assert.equal(created[0].dueDate, TODAY);
  assert.deepEqual(moved, ['AQ-101:11']);
  const saved = await readAnalysis(deps.store, ID);
  assert.equal(openTrackingOf(saved), 'AQ-101');
  assert.equal(saved?.trackingTasks[0].estimateSeconds, 5400);
  assert.equal(saved?.taskRuns['AQ-101']?.status, 'started');
});

test('con historia de gestión: subtarea bajo ella', async () => {
  const { jira, created } = trackingJira({ [MANAGEMENT_STORY]: {} });
  const outcome = await createAnalysisTracking(await trackingDeps(jira, MANAGEMENT_STORY), ID, INPUT, null);
  assert.equal(outcome.ok, true);
  assert.equal(created[0].parentKey, MANAGEMENT_STORY);
  assert.equal(created[0].issueTypeName, 'Subtarea');
});

test('sin gestión y sin destino: pide elegir dónde y no crea nada; con la clave elegida se crea ahí', async () => {
  const { jira, created } = trackingJira({ [EPIC]: { type: 'Epic' } });
  const deps = await trackingDeps(jira, null);
  const ask = await createAnalysisTracking(deps, ID, INPUT, null);
  assert.equal(ask.ok, false);
  assert.equal(!ask.ok && ask.askWhere, true);
  assert.equal(created.length, 0);
  const outcome = await createAnalysisTracking(deps, ID, INPUT, EPIC);
  assert.deepEqual(outcome, { ok: true, issueKey: 'AQ-101', started: true });
  assert.equal(created[0].parentKey, EPIC);
});

test('la de gestión inservible (finalizada, inexistente o subtarea) pide elegir dónde sin crear nada', async () => {
  const cases: Array<[Record<string, FakeIssueSpec>, string]> = [
    [{ [MANAGEMENT_STORY]: { status: 'done' } }, MANAGEMENT_STORY],
    [{}, MISSING],
    [{ [MANAGEMENT_STORY]: { type: 'Subtarea' } }, MANAGEMENT_STORY],
  ];
  for (const [others, management] of cases) {
    const { jira, created } = trackingJira(others);
    const outcome = await createAnalysisTracking(await trackingDeps(jira, management), ID, INPUT, null);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.askWhere, true, management);
    assert.equal(created.length, 0);
  }
});

test('una clave escrita a mano que no sirve vuelve a preguntar dónde; la estimación inválida es un fallo normal', async () => {
  const { jira, created } = trackingJira({ [MANAGEMENT_STORY]: { status: 'done' } });
  const deps = await trackingDeps(jira, null);
  const bad = await createAnalysisTracking(deps, ID, INPUT, MANAGEMENT_STORY);
  assert.equal(!bad.ok && bad.askWhere, true);
  const invalid = await createAnalysisTracking(deps, ID, { estimate: 'xx', dueDate: 'hoy' }, MANAGEMENT_STORY);
  assert.equal(invalid.ok, false);
  assert.equal(!invalid.ok && invalid.askWhere, undefined);
  assert.equal(created.length, 0);
});

test('finalizar: pasa a Finalizada en Jira y deja el cierre en el análisis, nunca en una historia', async () => {
  const { jira, moved } = trackingJira({ [EPIC]: { type: 'Epic' } });
  const deps = await trackingDeps(jira, EPIC);
  await createAnalysisTracking(deps, ID, INPUT, null);
  const finishedAt = new Date('2026-11-09T17:00:00.000Z');
  const outcome = await finishAnalysisTask({ jira, store: deps.store, now: () => finishedAt }, ID, 'AQ-101');
  // Jira cuenta la tarea nueva como "Por hacer": no ofrece el cierre automático sin nombre conocido
  assert.ok(outcome.kind === 'ok' || outcome.kind === 'choose');
  if (outcome.kind === 'choose') {
    const chosen = await finishAnalysisTask({ jira, store: deps.store, now: () => finishedAt }, ID, 'AQ-101', {
      transitionName: 'Terminar',
    });
    assert.equal(chosen.kind, 'ok');
  }
  assert.ok(moved.includes('AQ-101:31'));
  const saved = await readAnalysis(deps.store, ID);
  assert.equal(saved?.taskRuns['AQ-101'].status, 'done');
  assert.equal(saved?.taskRuns['AQ-101'].finishedAt, finishedAt.toISOString());
  assert.equal(openTrackingOf(saved), null);
});

test('calibración: las tareas de análisis finalizadas entran en el grupo de Planificaciones y en la sugerencia', async () => {
  const { jira } = trackingJira({ [EPIC]: { type: 'Epic' } });
  const deps = await trackingDeps(jira, EPIC);
  await createAnalysisTracking(deps, ID, { estimate: '2h', dueDate: 'hoy' }, null);
  const open = (await readAnalysis(deps.store, ID))!;
  const asSource = (a: typeof open) => ({ planningTasks: a.trackingTasks, taskRuns: a.taskRuns });
  assert.equal(planningGroupOf([asSource(open)]).count, 0, 'abierta no cuenta');
  const closed = structuredClone(open);
  closed.taskRuns['AQ-101'] = {
    ...closed.taskRuns['AQ-101'],
    status: 'done',
    finishedAt: '2026-11-09T17:00:00.000Z',
  };
  const group = planningGroupOf([asSource(closed)]);
  assert.deepEqual(group, { count: 1, estimateSeconds: 7200, elapsedSeconds: 2 * 3600 });
  assert.equal(suggestPlanning(group).estimate, '2h');
});

test('crear no pisa un análisis existente con ese id', async () => {
  const { store } = await newAnalysis('Original');
  await assert.rejects(createAnalysis(store, ID, 'Otro', PROJECT), /ya existe/);
  assert.equal((await readAnalysis(store, ID))?.name, 'Original');
});

test('un estado.json ilegible aparece igual en el inicio con el proyecto activo y no cuenta para el filtro', async () => {
  const { store } = await newAnalysis();
  const broken = createAnalysisProjectStore(await tempRoot(), 'an-2');
  await broken.ensureReady();
  await broken.writeText('estado.json', '{ no es json');
  const states = await listAnalysesFrom([
    { id: ID, store },
    { id: 'an-2', store: broken },
  ]);
  const visible = filterAnalysesByProject(states, 'OTRO');
  assert.deepEqual(visible.map((s) => s.id), ['an-2'], 'el legible de otro proyecto se oculta; el ilegible no');
  assert.equal(visible[0].unreadable, true);
  assert.match(visible[0].name, /ilegible/);
});

test('fuentes: los nombres que solo difieren en mayúsculas cuentan como repetidos', async () => {
  const { store } = await newAnalysis();
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-case-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-case-b-'));
  const a = await sourceFile(dirA, 'Nota.md', 'A');
  const b = await sourceFile(dirB, 'NOTA.MD', 'B');
  const results = await addSources(store, ID, { paths: `${a};${b}`, text: '' });
  assert.deepEqual(results.map((r) => r.ok && r.file), ['Nota.md', 'NOTA-2.MD']);
});

test('fuentes: un texto pegado que pasa el tope se rechaza con su motivo y no se guarda', async () => {
  const { store } = await newAnalysis();
  const results = await addSources(store, ID, { paths: '', text: 'x'.repeat(MAX_ATTACHMENT_BYTES + 1) });
  assert.equal(results[0].ok, false);
  assert.match(results[0].ok ? '' : results[0].message, /pesa más de 20 MB/);
  assert.equal(await store.exists('fuentes/texto.md'), false);
  assert.deepEqual((await readAnalysis(store, ID))?.sources, []);
  // Lo ya guardado más lo nuevo también cuenta
  await addSources(store, ID, { paths: '', text: 'x'.repeat(MAX_ATTACHMENT_BYTES - 10) });
  const second = await addSources(store, ID, { paths: '', text: 'y'.repeat(100) });
  assert.equal(second[0].ok, false);
});
