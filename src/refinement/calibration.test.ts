import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, elapsedMsOf, measuresOf, OUTLIER_LIMIT, realTimesOf } from './calibration';
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
    claudeSeconds: 60 * (i + 2),
    elapsedSeconds: 60,
  }));
  assert.equal(calibrate([{ measures: many, excludedDirect: 0 }]).outliers.length, OUTLIER_LIMIT);
});
