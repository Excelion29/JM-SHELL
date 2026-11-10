import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ANALYSIS_POINTS_FILE, ANALYSIS_STATE_FILE, createAnalysis, readAnalysis } from './analysis';
import { finishPoint, giveBackPoint, loadPointsModel, pointsGroupOf, startPoint } from './analysis-point-runs';
import { renderPointContext } from './analysis-point-context';
import { validatePoints } from './analysis-points';
import { removeAnalysis } from './analysis-remove';
import {
  assertSafeArgs,
  buildNewSessionArgs,
  taskHandoffArgs,
  TASK_DENIED_COMMANDS,
  workFilesOf,
} from './claude';
import { createAnalysisProjectStore } from './project-store';
import { tempRoot } from './test-support';
import { workDirFor } from './workdir';

const ID = 'an-1';
const SESSION = '11111111-2222-3333-4444-555555555555';
const T0 = new Date('2026-01-01T10:00:00.000Z');
const HOUR_MS = 3_600_000;
const later = (ms: number) => new Date(T0.getTime() + ms);

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

async function setup(points: unknown[] = [rawPoint('P1'), rawPoint('P2'), rawPoint('P5', { outOfScope: true })]) {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, ID);
  await createAnalysis(store, ID, 'Observaciones', 'AQ');
  await store.writeText(ANALYSIS_POINTS_FILE, JSON.stringify({ points }));
  return { root, store };
}

test('el modelo lista solo los puntos en alcance, con estado y esperado PERT', async () => {
  const { store } = await setup();
  const model = await loadPointsModel(store, ID, T0);
  assert.equal(model.kind, 'ready');
  const rows = model.kind === 'ready' ? model.rows : [];
  assert.deepEqual(
    rows.map((row) => [row.id, row.status, row.estimateSeconds]),
    [
      ['P1', 'pending', 3600],
      ['P2', 'pending', 3600],
    ],
  );
});

test('sin puntos.json el modelo es missing y con uno inválido, invalid (sin lanzar)', async () => {
  const { store } = await setup();
  await store.remove(ANALYSIS_POINTS_FILE);
  assert.equal((await loadPointsModel(store, ID)).kind, 'missing');
  await store.writeText(ANALYSIS_POINTS_FILE, JSON.stringify({ points: [rawPoint('x1')] }));
  const model = await loadPointsModel(store, ID);
  assert.equal(model.kind, 'invalid');
  assert.match(model.kind === 'invalid' ? model.message : '', /"id" debe ser P1/);
});

test('un id de punto que no es P<n> se rechaza al validar puntos.json', () => {
  for (const id of ['p1', 'P', 'P12345', 'P1;rm', '../P1', 'Q1']) {
    assert.throws(() => validatePoints({ points: [rawPoint(id)] }), /"id" debe ser P1/, id);
  }
});

test('iniciar marca en curso con inicio medido y reabrir exige confirmación y conserva el tiempo', async () => {
  const { store } = await setup();
  assert.deepEqual(await startPoint(store, ID, 'P1', {}, T0), { kind: 'ok' });
  const run = (await readAnalysis(store, ID))?.pointRuns.P1;
  assert.equal(run?.status, 'started');
  assert.equal(run?.startedAt, T0.toISOString());

  await finishPoint(store, ID, 'P1', later(HOUR_MS));
  assert.equal((await readAnalysis(store, ID))?.pointRuns.P1.status, 'done');
  assert.deepEqual(await startPoint(store, ID, 'P1', {}, later(2 * HOUR_MS)), { kind: 'needs-reopen' });
  assert.deepEqual(await startPoint(store, ID, 'P1', { reopen: true }, later(2 * HOUR_MS)), { kind: 'ok' });
  const reopened = (await readAnalysis(store, ID))?.pointRuns.P1;
  assert.equal(reopened?.status, 'started');
  assert.equal(reopened?.priorElapsedMs, HOUR_MS);
});

test('iniciar rechaza puntos fuera de alcance, inexistentes o con id raro, sin escribir nada', async () => {
  const { store } = await setup();
  for (const pointId of ['P5', 'P9', 'p1', '../x']) {
    const outcome = await startPoint(store, ID, pointId, {}, T0);
    assert.equal(outcome.kind, 'failed', pointId);
  }
  assert.deepEqual((await readAnalysis(store, ID))?.pointRuns, {});
});

test('devolver conserva el tiempo y vuelve a pendiente; solo vale con el punto en curso', async () => {
  const { store } = await setup();
  await assert.rejects(giveBackPoint(store, ID, 'P1', T0), /no está en curso/);
  await startPoint(store, ID, 'P1', {}, T0);
  await giveBackPoint(store, ID, 'P1', later(HOUR_MS));
  const model = await loadPointsModel(store, ID, later(5 * HOUR_MS));
  const row = model.kind === 'ready' ? model.rows[0] : null;
  assert.equal(row?.status, 'pending');
  assert.equal(row?.realElapsedSeconds, 3600);
  await startPoint(store, ID, 'P1', {}, later(2 * HOUR_MS));
  assert.equal((await readAnalysis(store, ID))?.pointRuns.P1.priorElapsedMs, HOUR_MS);
  assert.equal((await readAnalysis(store, ID))?.pointRuns.P1.returned, undefined);
});

test('finalizar sin haber iniciado queda como cierre directo (sin tiempo medido)', async () => {
  const { store } = await setup();
  await finishPoint(store, ID, 'P2', later(HOUR_MS));
  const run = (await readAnalysis(store, ID))?.pointRuns.P2;
  assert.equal(run?.status, 'done');
  assert.equal(run?.finishedDirect, true);
  assert.equal(run?.startedAt, null);
});

test('el estado leído descarta entradas de pointRuns con id malo o sin inicio y no toca puntos.json', async () => {
  const { store } = await setup();
  const before = await store.readText(ANALYSIS_POINTS_FILE);
  const raw = JSON.parse((await store.readText(ANALYSIS_STATE_FILE)) as string);
  raw.pointRuns = {
    P1: { startedAt: T0.toISOString(), status: 'started', activeMs: 5, claudeSessionId: SESSION },
    p2: { startedAt: T0.toISOString(), status: 'started' },
    'P1; rm': { startedAt: T0.toISOString(), status: 'started' },
    P3: { status: 'started' },
    P4: 'basura',
  };
  await store.writeText(ANALYSIS_STATE_FILE, JSON.stringify(raw));
  const state = await readAnalysis(store, ID);
  assert.deepEqual(Object.keys(state?.pointRuns ?? {}), ['P1']);
  assert.equal(state?.pointRuns.P1.activeMs, 5);
  assert.equal(state?.pointRuns.P1.claudeSessionId, SESSION);
  await startPoint(store, ID, 'P2', {}, T0);
  assert.equal(await store.readText(ANALYSIS_POINTS_FILE), before);
});

test('borrar se niega con puntos iniciados (también si la entrada no se puede leer) y no borra nada', async () => {
  const { store, root } = await setup();
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jm-work-'));
  await startPoint(store, ID, 'P1', {}, T0);
  const message = `${ID} tiene puntos iniciados; no lo borro para no perder su tiempo.`;
  assert.deepEqual(await removeAnalysis(store, workDir, ID), { ok: false, message });
  assert.equal(fs.existsSync(path.join(root, '.jm', 'analisis', ID, ANALYSIS_STATE_FILE)), true);

  const raw = JSON.parse((await store.readText(ANALYSIS_STATE_FILE)) as string);
  raw.pointRuns = { zzz: 'basura' };
  await store.writeText(ANALYSIS_STATE_FILE, JSON.stringify(raw));
  assert.deepEqual(await removeAnalysis(store, workDir, ID), { ok: false, message });
});

test('la calibración mide solo los puntos finalizados tras iniciarlos con estimación', async () => {
  const { store } = await setup([rawPoint('P1'), rawPoint('P2'), rawPoint('P3'), rawPoint('P4', { outOfScope: true })]);
  await startPoint(store, ID, 'P1', {}, T0);
  await finishPoint(store, ID, 'P1', later(2 * HOUR_MS));
  await finishPoint(store, ID, 'P2', later(HOUR_MS));
  await startPoint(store, ID, 'P3', {}, T0);
  const state = await readAnalysis(store, ID);
  const points = validatePoints({
    points: [rawPoint('P1'), rawPoint('P2'), rawPoint('P3'), rawPoint('P4', { outOfScope: true })],
  });
  const group = pointsGroupOf([{ points, runs: state?.pointRuns ?? {} }]);
  assert.deepEqual(group, { count: 1, estimateSeconds: 3600, elapsedSeconds: 7200 });
});

test('la sesión de un punto: ningún texto del punto viaja por argv y todo pasa la barrera de seguridad', () => {
  const evil = rawPoint('P1', { title: 'x"; rm -rf / & `calc`', analysis: '$(whoami) --dangerously-skip-permissions' });
  const point = validatePoints({ points: [evil] })[0];
  const context = renderPointContext({
    analysisId: ID,
    analysisName: 'Obs',
    point,
    knowledgeContext: null,
    expected: '1h',
  });
  assert.ok(context.includes('rm -rf'));

  const workDir = workDirFor(path.join(os.tmpdir(), 'jm-proyecto-de-prueba'));
  const files = workFilesOf(workDir, ID);
  const args = [...taskHandoffArgs(null, files), ...buildNewSessionArgs(ID, SESSION, 'ejecutar', 'P1')];
  const joined = args.join(' ');
  for (const text of [point.title, point.analysis, point.proposal, 'rm -rf', 'whoami']) {
    assert.ok(!joined.includes(text), text);
  }
  assert.ok(args.includes(`/ejecutar ${ID} P1`));
  assert.ok(args.includes(`ejecutar ${ID} P1`));
  const workBase = path.dirname(workDir);
  assert.doesNotThrow(() => assertSafeArgs(args, workBase));
  assert.doesNotThrow(() => assertSafeArgs(['--resume', SESSION], workBase));
  assert.throws(() => assertSafeArgs(buildNewSessionArgs(ID, SESSION, 'ejecutar', 'P1;x'), workBase), /no permitido/);
  assert.throws(() => assertSafeArgs(['/ejecutar an-1 P1 extra'], workBase), /no permitido/);
  assert.ok(TASK_DENIED_COMMANDS.includes('Bash(git commit:*)'));
});

test('el contexto del punto quita secuencias de control y recorta lo enorme', () => {
  const point = validatePoints({
    points: [rawPoint('P1', { title: 'A\u001b]52;c;Zm9v\u0007B', analysis: 'x'.repeat(50_000) })],
  })[0];
  const context = renderPointContext({
    analysisId: ID,
    analysisName: 'Obs',
    point,
    knowledgeContext: 'Base: ruta',
    expected: null,
  });
  assert.ok(!context.includes('\u001b'));
  assert.ok(context.length < 20_000);
  assert.ok(context.includes('Base: ruta'));
  assert.ok(context.includes('Nunca hagas commit ni push'));
});

test('el mensaje de un puntos.json inválido llega sin secuencias de terminal', async () => {
  const { store } = await setup();
  await store.writeText(ANALYSIS_POINTS_FILE, JSON.stringify({ points: [rawPoint('\u001b]0;x\u0007P1')] }));
  const model = await loadPointsModel(store, ID);
  assert.equal(model.kind, 'invalid');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(model.kind === 'invalid' ? model.message : ''));
});
