import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, DAILY_CAPACITY_SECONDS, parseDueDateInput, recommendSchedule, scheduleOf, todayIso } from './schedule';
import { task } from './test-support';

const HOUR = 3600;
// 2026-11-05 es jueves; 2026-11-07 sábado; 2026-11-08 domingo; 2026-11-09 lunes
const THURSDAY = '2026-11-05';
const items = (...hours: number[]) => hours.map((h, i) => ({ id: `T${i + 1}`, seconds: h * HOUR }));
const datesOf = (hours: number[], today: string) => [...recommendSchedule(items(...hours), today).values()];

const TABLE: Array<[string, number[], string, string[]]> = [
  ['llena el día', [3, 3, 2], THURSDAY, [THURSDAY, THURSDAY, THURSDAY]],
  ['pasa al día siguiente cuando no cabe', [5, 4], THURSDAY, [THURSDAY, '2026-11-06']],
  ['salta sábado y domingo al avanzar', [8, 1, 8], '2026-11-06', ['2026-11-06', '2026-11-09', '2026-11-10']],
  ['una tarea mayor que un día ocupa su propio día', [2, 10, 1], THURSDAY, [THURSDAY, '2026-11-06', '2026-11-09']],
  ['una tarea grande al inicio no desplaza el comienzo', [10, 1], THURSDAY, [THURSDAY, '2026-11-06']],
  ['empieza hoy aunque hoy sea sábado', [4, 4, 4], '2026-11-07', ['2026-11-07', '2026-11-07', '2026-11-09']],
  ['empieza hoy aunque hoy sea domingo', [8, 1], '2026-11-08', ['2026-11-08', '2026-11-09']],
];

for (const [name, hours, today, expected] of TABLE) {
  test(`recommendSchedule: ${name}`, () => assert.deepEqual(datesOf(hours, today), expected));
}

test('la capacidad diaria es de 8 horas', () => assert.equal(DAILY_CAPACITY_SECONDS, 8 * HOUR));

test('parseDueDateInput acepta fecha, hoy, mañana y +N, y rechaza lo demás', () => {
  assert.equal(parseDueDateInput('2026-12-25', THURSDAY), '2026-12-25');
  assert.equal(parseDueDateInput(' Hoy ', THURSDAY), THURSDAY);
  assert.equal(parseDueDateInput('mañana', THURSDAY), '2026-11-06');
  assert.equal(parseDueDateInput('+2', THURSDAY), '2026-11-07');
  for (const bad of ['', 'ayer', '2026-02-30', '+x', '05/11/2026']) {
    assert.throws(() => parseDueDateInput(bad, THURSDAY), /Fecha inválida/);
  }
});

test('todayIso y addDays usan fechas de calendario', () => {
  assert.equal(todayIso(new Date(2026, 10, 5, 23, 59)), THURSDAY);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('scheduleOf solo agenda tareas marcadas y respeta las fechas manuales', () => {
  const plan = {
    storyKey: 'AQ-1',
    tasks: [
      task('T1', { finalEstimate: '8h' }),
      task('T2', { include: false }),
      task('T3', { dueDate: '2026-11-08', dueDateManual: true }),
      task('T4', { dueDate: '2026-12-01' }),
    ],
  };
  const schedule = scheduleOf(plan, THURSDAY);
  assert.equal(schedule.has('T2'), false);
  assert.deepEqual(schedule.get('T1'), { recommended: THURSDAY, dueDate: THURSDAY, manual: false });
  assert.deepEqual(schedule.get('T3'), { recommended: '2026-11-06', dueDate: '2026-11-08', manual: true });
  // dueDate sin dueDateManual se ignora: la recomendación se recalcula
  assert.equal(schedule.get('T4')?.manual, false);
});
