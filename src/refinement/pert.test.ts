import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedSeconds, parseEstimate, planTotals, stdDevSeconds } from './pert';
import { PlannedTask, RefinementPlan } from './types';

const task = (id: string, o: string, m: string, p: string, include = true): PlannedTask => ({
  id,
  summary: id,
  description: '',
  doneCriteria: [],
  estimate: { optimistic: o, likely: m, pessimistic: p },
  risk: 'low',
  rationale: '',
  include,
  attachments: [],
});

test('PERT: esperado y desviación', () => {
  assert.equal(expectedSeconds(1800, 3600, 7200), 3900);
  assert.equal(stdDevSeconds(1800, 7200), 900);
});

test('parseEstimate valida el orden o <= m <= p', () => {
  assert.deepEqual(parseEstimate({ optimistic: '30m', likely: '1h', pessimistic: '2h' }), {
    optimistic: 1800,
    likely: 3600,
    pessimistic: 7200,
  });
  assert.throws(() => parseEstimate({ optimistic: '2h', likely: '1h', pessimistic: '3h' }), /optimista <= probable/);
  assert.throws(() => parseEstimate({ optimistic: '1h', likely: '30m', pessimistic: '3h' }));
  assert.throws(() => parseEstimate({ optimistic: 'x', likely: '1h', pessimistic: '3h' }), /Invalid time format/);
});

test('planTotals solo suma las tareas incluidas', () => {
  const plan: RefinementPlan = {
    storyKey: 'AQ-1',
    tasks: [task('T1', '30m', '1h', '2h'), task('T2', '1h', '1h', '1h'), task('T3', '8h', '8h', '8h', false)],
  };
  const totals = planTotals(plan);
  assert.equal(totals.taskCount, 2);
  assert.equal(totals.expectedSeconds, 3900 + 3600);
  assert.equal(totals.stdDevSeconds, 900);
});
