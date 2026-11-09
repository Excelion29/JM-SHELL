import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustedSeconds,
  calibrate,
  elapsedMsOf,
  estimateFactors,
  factorFor,
  MAX_FACTOR,
  measuresOf,
  MIN_FACTOR,
  OUTLIER_LIMIT,
  realTimesOf,
  type StoryMeasures,
  type TaskMeasure,
} from './calibration';
import { task } from './test-support';
import type { RefinementPlan, StoryState, TaskRun } from './types';

const HOUR_MS = 3600 * 1000;
const NOW = new Date('2026-11-07T12:00:00.000Z');

const run = (issueKey: string, patch: Partial<TaskRun> = {}): TaskRun => ({
  issueKey,
  claudeSessionId: null,
  startedAt: '2026-11-07T08:00:00.000Z',
  finishedAt: '2026-11-07T10:00:00.000Z',
  activeMs: HOUR_MS,
  status: 'done',
  ...patch,
});

function story(key: string, createdIssues: Record<string, string>, taskRuns: Record<string, TaskRun>): StoryState {
  return {
    key,
    summary: 'Historia',
    phase: 'in-progress',
    block: null,
    claudeSessionId: null,
    parentKey: null,
    createdIssues,
    taskRuns,
    attachments: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 },
    updatedAt: NOW.toISOString(),
  };
}

const plan = (tasks: RefinementPlan['tasks']): RefinementPlan => ({ storyKey: 'AQ-45', tasks }) as RefinementPlan;

test('realTimesOf: Claude abierto e inicio a fin; en curso corre hasta ahora; sin inicio no hay medida', () => {
  assert.deepEqual(realTimesOf(run('AQ-1'), NOW), { claudeSeconds: 3600, elapsedSeconds: 7200 });
  assert.deepEqual(realTimesOf(run('AQ-1', { finishedAt: null, status: 'started' }), NOW), {
    claudeSeconds: 3600,
    elapsedSeconds: 4 * 3600,
  });
  const none = { claudeSeconds: null, elapsedSeconds: null };
  assert.deepEqual(realTimesOf(undefined, NOW), none);
  assert.deepEqual(realTimesOf(run('AQ-1', { finishedDirect: true, startedAt: null }), NOW), none);
});

test('al reabrir, el inicio a fin suma los tramos anteriores igual que el tiempo con Claude', () => {
  const first = run('AQ-1');
  assert.equal(elapsedMsOf(first), 2 * HOUR_MS);
  const reopened = run('AQ-1', {
    startedAt: '2026-11-07T11:00:00.000Z',
    finishedAt: null,
    status: 'started',
    activeMs: 2 * HOUR_MS,
    priorElapsedMs: elapsedMsOf(first),
  });
  assert.deepEqual(realTimesOf(reopened, NOW), { claudeSeconds: 7200, elapsedSeconds: 3 * 3600 });
});

test('una finalizada sin nada medido (0 con Claude y 0 de inicio a fin) cuenta como excluida', () => {
  const at = '2026-11-07T09:00:00.000Z';
  const state = story(
    'AQ-45',
    { T1: 'AQ-101' },
    { 'AQ-101': run('AQ-101', { startedAt: at, finishedAt: at, activeMs: 0 }) },
  );
  const result = measuresOf(state, plan([task('T1')]), NOW);
  assert.deepEqual(result, { measures: [], excludedDirect: 1 });
});

test('measuresOf toma solo finalizadas del plan iniciadas con jm y cuenta aparte las cerradas con f', () => {
  const state = story(
    'AQ-45',
    { T1: 'AQ-101', T2: 'AQ-102', T3: 'AQ-103', T4: 'AQ-104', T5: 'AQ-105' },
    {
      'AQ-101': run('AQ-101'),
      'AQ-102': run('AQ-102', { status: 'started', finishedAt: null }),
      'AQ-103': run('AQ-103', { startedAt: null, activeMs: 0, finishedDirect: true }),
      'AQ-105': run('AQ-105'),
    },
  );
  // T5 no está en el plan: sin estimación propia no se compara
  const result = measuresOf(state, plan([task('T1', { finalEstimate: '2h' }), task('T2'), task('T3')]), NOW);
  assert.equal(result.excludedDirect, 1);
  assert.deepEqual(result.measures, [
    {
      key: 'AQ-101',
      storyKey: 'AQ-45',
      title: 'Tarea T1',
      risk: 'medium',
      estimateSeconds: 7200,
      recommendedSeconds: 3900,
      claudeSeconds: 3600,
      elapsedSeconds: 7200,
    },
  ]);
});

test('calibrate suma por grupo, calcula real / estimado, separa por riesgo y ordena las más desviadas', () => {
  const measure = (key: string, risk: 'low' | 'high', estimate: number, claude: number) => ({
    key,
    storyKey: 'AQ-45',
    title: key,
    risk,
    estimateSeconds: estimate,
    recommendedSeconds: estimate,
    claudeSeconds: claude,
    elapsedSeconds: claude * 2,
  });
  const model = calibrate(
    [
      { measures: [measure('A', 'low', 3600, 1800), measure('B', 'high', 3600, 7200)], excludedDirect: 1 },
      { measures: [measure('C', 'low', 1800, 1800)], excludedDirect: 2 },
    ],
    1,
  );
  assert.equal(model.total.count, 3);
  assert.equal(model.total.estimateSeconds, 9000);
  assert.equal(model.total.claudeSeconds, 10800);
  assert.equal(model.total.claudeRatio, 1.2);
  assert.equal(model.total.elapsedRatio, 2.4);
  assert.deepEqual(
    model.byRisk.map((g) => [g.risk, g.count, g.claudeRatio]),
    [
      ['low', 2, 3600 / 5400],
      ['high', 1, 2],
    ],
  );
  assert.deepEqual(
    model.outliers.map((o) => o.key),
    ['B', 'A', 'C'],
  );
  assert.equal(model.excludedDirect, 3);
  assert.equal(model.unreadable, 1);
});

test('calibrate sin medidas devuelve totales en cero, sin ratios y como mucho OUTLIER_LIMIT desviadas', () => {
  const empty = calibrate([]);
  assert.equal(empty.total.count, 0);
  assert.equal(empty.total.claudeRatio, null);
  assert.deepEqual(empty.byRisk, []);
  const many = Array.from({ length: OUTLIER_LIMIT + 3 }, (_, i) => ({
    key: `K${i}`,
    storyKey: 'AQ-45',
    title: `K${i}`,
    risk: 'low' as const,
    estimateSeconds: 60,
    recommendedSeconds: 60,
    claudeSeconds: 60 * (i + 2),
    elapsedSeconds: 60,
  }));
  assert.equal(calibrate([{ measures: many, excludedDirect: 0 }]).outliers.length, OUTLIER_LIMIT);
});

// Medidas sintéticas: estimado 1h y real de inicio a fin dado (Claude no cuenta para el ajuste)
const measure = (risk: TaskMeasure['risk'], elapsedHours: number): TaskMeasure => ({
  key: 'AQ-1',
  storyKey: 'AQ-45',
  title: 'T',
  risk,
  estimateSeconds: 3600,
  recommendedSeconds: 3600,
  claudeSeconds: 60,
  elapsedSeconds: elapsedHours * 3600,
});
const factorsOf = (...measures: TaskMeasure[]) => estimateFactors([{ measures, excludedDirect: 0 } satisfies StoryMeasures]);

test('estimateFactors: sin medidas no hay factor ni ajustado', () => {
  const factors = factorsOf();
  assert.equal(factorFor(factors, 'medium'), null);
  assert.equal(adjustedSeconds(3600, null), null);
});

test('estimateFactors: usa de inicio a fin y con pocas medidas se acerca a 1', () => {
  // 1 medida al doble: (1 × 2 + 5) ÷ 6
  const one = factorsOf(measure('medium', 2)).total;
  assert.ok(one && Math.abs(one.factor - 7 / 6) < 1e-9 && one.count === 1);
  // 20 medidas al doble: (20 × 2 + 5) ÷ 25 = 1,8
  const many = factorsOf(...Array.from({ length: 20 }, () => measure('medium', 2))).total;
  assert.ok(many && Math.abs(many.factor - 1.8) < 1e-9);
});

test('estimateFactors: el factor queda entre los topes', () => {
  const slow = factorsOf(...Array.from({ length: 50 }, () => measure('high', 10))).total;
  const fast = factorsOf(...Array.from({ length: 50 }, () => measure('low', 0.05))).total;
  assert.equal(slow?.factor, MAX_FACTOR);
  assert.equal(fast?.factor, MIN_FACTOR);
});

test('factorFor: el riesgo propio con 3 o más medidas; si no, el total', () => {
  const factors = factorsOf(measure('high', 3), measure('high', 3), measure('high', 3), measure('low', 1));
  assert.equal(factorFor(factors, 'high')?.count, 3);
  assert.equal(factorFor(factors, 'low')?.count, 4, 'low tiene 1 medida: usa el total');
  assert.equal(factorFor(factors, 'medium')?.count, 4);
});

test('adjustedSeconds: recomendada × factor redondeado a 5 minutos', () => {
  assert.equal(adjustedSeconds(3600, { factor: 1.3, count: 8 }), 4800);
  assert.equal(adjustedSeconds(600, { factor: 0.5, count: 8 }), 300);
});

test('estimateFactors: se mide contra la recomendada, así usar el ajustado no borra el factor', () => {
  // Recomendada 1h, se envió el ajustado 2h y tomó 2h: sigue siendo el doble de lo recomendado
  const used = { ...measure('medium', 2), estimateSeconds: 7200 };
  const factor = factorsOf(...Array.from({ length: 20 }, () => used)).total;
  assert.ok(factor && Math.abs(factor.factor - 1.8) < 1e-9);
});
