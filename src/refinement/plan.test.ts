import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanValidationError, validatePlan } from './plan';

const goodTask = () => ({
  id: 'T1',
  summary: 'Crear endpoint',
  description: 'Detalle',
  doneCriteria: ['Pasa el test'],
  estimate: { optimistic: '30m', likely: '1h', pessimistic: '2h' },
  risk: 'low',
  rationale: 'Parecido a AQ-10',
  include: true,
  attachments: [],
});

const planWith = (patch: Record<string, unknown>) => ({ storyKey: 'AQ-45', tasks: [{ ...goodTask(), ...patch }] });

test('acepta un plan válido', () => {
  const plan = validatePlan({ storyKey: 'AQ-45', tasks: [goodTask()] });
  assert.equal(plan.tasks[0].id, 'T1');
});

test('tolera description, rationale y attachments ausentes', () => {
  const minimal: Record<string, unknown> = goodTask();
  for (const field of ['description', 'rationale', 'attachments']) delete minimal[field];
  const plan = validatePlan({ storyKey: 'AQ-45', tasks: [minimal] });
  assert.deepEqual(plan.tasks[0].attachments, []);
  assert.equal(plan.tasks[0].description, '');
});

const failures: Array<[string, unknown, RegExp]> = [
  ['no es objeto', [], /objeto JSON/],
  ['sin storyKey', { tasks: [] }, /storyKey/],
  ['sin tasks', { storyKey: 'AQ-1' }, /tasks/],
  ['risk inválido', planWith({ risk: 'extreme' }), /La tarea T1.*risk/],
  ['include no booleano', planWith({ include: 'yes' }), /La tarea T1.*include/],
  ['sin summary', planWith({ summary: '' }), /La tarea T1.*summary/],
  ['doneCriteria no lista', planWith({ doneCriteria: 'x' }), /La tarea T1.*doneCriteria/],
  ['estimate ausente', planWith({ estimate: undefined }), /La tarea T1.*estimate/],
  [
    'estimate desordenada',
    planWith({ estimate: { optimistic: '2h', likely: '1h', pessimistic: '3h' } }),
    /La tarea T1.*estimación inválida/,
  ],
  [
    'estimate ilegible',
    planWith({ estimate: { optimistic: 'a', likely: '1h', pessimistic: '3h' } }),
    /estimación inválida/,
  ],
  ['id repetido', { storyKey: 'AQ-1', tasks: [goodTask(), goodTask()] }, /repetida/],
];

for (const [name, input, message] of failures) {
  test(`rechaza: ${name}`, () => {
    assert.throws(
      () => validatePlan(input),
      (err: unknown) => err instanceof PlanValidationError && message.test(err.message),
    );
  });
}
