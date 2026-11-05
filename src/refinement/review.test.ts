import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import {
  assertSafeToOpen,
  loadReview,
  previewEstimate,
  setAttachmentPurpose,
  toggleAttachmentTask,
  updateTask,
} from './review';
import { planPath, readState } from './state';
import { attachment, seedStory, task, tempRoot } from './test-support';

const KEY = 'AQ-45';
const ONE_HOUR = 3600;

async function seeded(extra: Parameters<typeof seedStory>[3] = {}) {
  const root = await tempRoot();
  await seedStory(
    root,
    KEY,
    [task('T1'), task('T2', { estimate: { optimistic: '1h', likely: '2h', pessimistic: '3h' } })],
    extra,
  );
  return root;
}

test('loadReview calcula esperado por tarea y totales', async () => {
  const model = await loadReview(await seeded(), KEY);
  // T1: (30m + 4*1h + 2h)/6 = 1h5m ; T2: 2h
  assert.equal(model.tasks[0].expectedSeconds, 3900);
  assert.equal(model.tasks[1].expectedSeconds, 2 * ONE_HOUR);
  assert.equal(model.totals.taskCount, 2);
  assert.equal(model.totals.expectedSeconds, 3900 + 2 * ONE_HOUR);
});

test('editar O/M/P recalcula, guarda en plan.json y pasa la fase de plan a revisado', async () => {
  const root = await seeded();
  const model = await updateTask(root, KEY, 'T1', { estimate: { optimistic: '1h', likely: '1h', pessimistic: '1h' } });
  assert.equal(model.tasks[0].expectedSeconds, ONE_HOUR);
  assert.equal(model.totals.expectedSeconds, ONE_HOUR + 2 * ONE_HOUR);
  const saved = await fs.readJson(planPath(root, KEY));
  assert.deepEqual(saved.tasks[0].estimate, { optimistic: '1h', likely: '1h', pessimistic: '1h' });
  assert.equal((await readState(root, KEY))?.phase, 'reviewed');
});

test('editar el título lo guarda y no admite uno vacío', async () => {
  const root = await seeded();
  await updateTask(root, KEY, 'T1', { summary: '  Nuevo título ' });
  assert.equal((await fs.readJson(planPath(root, KEY))).tasks[0].summary, 'Nuevo título');
  await assert.rejects(updateTask(root, KEY, 'T1', { summary: '  ' }), /vacío/);
});

test('una estimación inválida se rechaza y el plan queda intacto', async () => {
  const root = await seeded();
  const before = await fs.readFile(planPath(root, KEY), 'utf8');
  await assert.rejects(
    updateTask(root, KEY, 'T1', { estimate: { optimistic: '2h', likely: '1h', pessimistic: '3h' } }),
    /optimista <= probable/,
  );
  assert.equal(await fs.readFile(planPath(root, KEY), 'utf8'), before);
  assert.equal((await readState(root, KEY))?.phase, 'plan');
});

test('previewEstimate valida con las reglas del plan', () => {
  assert.deepEqual(previewEstimate({ optimistic: '30m', likely: '1h', pessimistic: '2h' }), {
    ok: true,
    expectedSeconds: 3900,
    stdDevSeconds: 900,
  });
  assert.equal(previewEstimate({ optimistic: 'x', likely: '1h', pessimistic: '2h' }).ok, false);
});

test('desmarcar una tarea la saca de los totales', async () => {
  const root = await seeded();
  const model = await updateTask(root, KEY, 'T2', { include: false });
  assert.equal(model.totals.taskCount, 1);
  assert.equal(model.totals.expectedSeconds, 3900);
  assert.equal((await fs.readJson(planPath(root, KEY))).tasks[1].include, false);
});

test('propósito y tareas de un adjunto quedan guardados en estado.json y plan.json', async () => {
  const root = await seeded({ files: { 'captura.png': 'x' } });
  assert.deepEqual((await loadReview(root, KEY)).files, [{ file: 'captura.png', purpose: 'analysis', taskIds: [] }]);
  await setAttachmentPurpose(root, KEY, 'captura.png', 'evidence');
  const model = await toggleAttachmentTask(root, KEY, 'captura.png', 'T2');
  assert.deepEqual(model.files, [{ file: 'captura.png', purpose: 'evidence', taskIds: ['T2'] }]);
  const state = await readState(root, KEY);
  assert.equal(state?.attachments[0].purpose, 'evidence');
  assert.deepEqual(state?.attachments[0].taskIds, ['T2']);
  assert.deepEqual((await fs.readJson(planPath(root, KEY))).tasks[1].attachments, ['captura.png']);
  const off = await toggleAttachmentTask(root, KEY, 'captura.png', 'T2');
  assert.deepEqual(off.files[0].taskIds, []);
});

test('un adjunto declarado por la skill en el plan aparece asignado', async () => {
  const root = await seeded({ files: { 'a.txt': 'x' } });
  const plan = await fs.readJson(planPath(root, KEY));
  plan.tasks[0].attachments = ['a.txt'];
  await fs.writeJson(planPath(root, KEY), plan);
  assert.deepEqual((await loadReview(root, KEY)).files[0].taskIds, ['T1']);
});

test('no asigna ni cambia archivos que no están en adjuntos', async () => {
  const root = await seeded({ attachments: [attachment('fantasma.txt')] });
  await assert.rejects(setAttachmentPurpose(root, KEY, 'fantasma.txt', 'team'), /no está en la carpeta/);
  await assert.rejects(setAttachmentPurpose(root, KEY, '../x', 'team'), /no está en la carpeta/);
});

test('una historia ya creada no admite cambios en el plan', async () => {
  const root = await seeded({ phase: 'created' });
  await assert.rejects(updateTask(root, KEY, 'T1', { include: false }), /ya no se puede revisar/);
});

test('assertSafeToOpen permite extensiones seguras sin distinguir mayúsculas', () => {
  assert.doesNotThrow(() => assertSafeToOpen('informe.PDF'));
  assert.doesNotThrow(() => assertSafeToOpen('captura.png'));
});

test('assertSafeToOpen rechaza ejecutables y archivos sin extensión', () => {
  for (const file of ['run.bat', 'x.CMD', 'a.hta', 'link.lnk', 'setup.exe', 'sinextension']) {
    assert.throws(() => assertSafeToOpen(file), /por seguridad/);
  }
});

const THURSDAY = '2026-11-05';
const FRIDAY = '2026-11-06';

test('loadReview recomienda fechas desde hoy y las recalcula en cada carga', async () => {
  const root = await seeded();
  const first = await loadReview(root, KEY, THURSDAY);
  assert.deepEqual(first.tasks.map((t) => [t.recommendedDate, t.effectiveDate, t.dateManual]), [
    [THURSDAY, THURSDAY, false],
    [THURSDAY, THURSDAY, false],
  ]);
  assert.equal(first.dailyCapacitySeconds, 8 * ONE_HOUR);
  assert.equal(first.daySeconds[THURSDAY], 3900 + 2 * ONE_HOUR);
  // Nada se persistió: al día siguiente la recomendación se corre sola
  const saved = await fs.readJson(planPath(root, KEY));
  assert.equal('dueDate' in saved.tasks[0], false);
  assert.equal((await loadReview(root, KEY, FRIDAY)).tasks[0].effectiveDate, FRIDAY);
});

test('la estimación final reemplaza a la recomendación en tarea y totales, y se puede borrar', async () => {
  const root = await seeded();
  const model = await updateTask(root, KEY, 'T1', { finalEstimate: ' 3h ' }, THURSDAY);
  assert.equal(model.tasks[0].recommendedSeconds, 3900);
  assert.equal(model.tasks[0].effectiveSeconds, 3 * ONE_HOUR);
  assert.equal(model.totals.effectiveSeconds, 3 * ONE_HOUR + 2 * ONE_HOUR);
  assert.equal(model.totals.expectedSeconds, 3900 + 2 * ONE_HOUR);
  assert.equal((await fs.readJson(planPath(root, KEY))).tasks[0].finalEstimate, '3h');
  const cleared = await updateTask(root, KEY, 'T1', { finalEstimate: '' }, THURSDAY);
  assert.equal(cleared.tasks[0].effectiveSeconds, 3900);
  assert.equal('finalEstimate' in (await fs.readJson(planPath(root, KEY))).tasks[0], false);
});

test('una estimación final inválida se rechaza y el plan queda intacto', async () => {
  const root = await seeded();
  const before = await fs.readFile(planPath(root, KEY), 'utf8');
  await assert.rejects(updateTask(root, KEY, 'T1', { finalEstimate: '3 horas' }), /Invalid time format/);
  await assert.rejects(updateTask(root, KEY, 'T1', { finalEstimate: '0m' }), /mayor que 0/);
  assert.equal(await fs.readFile(planPath(root, KEY), 'utf8'), before);
});

test('la fecha editada se guarda como manual (incluso fin de semana o sobre 8 h) y reiniciar vuelve a la recomendada', async () => {
  const root = await seeded();
  const manual = await updateTask(root, KEY, 'T2', { dueDate: '+2' }, THURSDAY);
  assert.deepEqual(
    [manual.tasks[1].effectiveDate, manual.tasks[1].recommendedDate, manual.tasks[1].dateManual],
    ['2026-11-07', THURSDAY, true],
  );
  const saved = (await fs.readJson(planPath(root, KEY))).tasks[1];
  assert.deepEqual([saved.dueDate, saved.dueDateManual], ['2026-11-07', true]);
  // La fecha manual se conserva aunque "hoy" cambie
  assert.equal((await loadReview(root, KEY, FRIDAY)).tasks[1].effectiveDate, '2026-11-07');
  assert.equal((await updateTask(root, KEY, 'T1', { dueDate: 'hoy' }, THURSDAY)).tasks[0].dateManual, true);

  const reset = await updateTask(root, KEY, 'T2', { dueDate: null }, THURSDAY);
  assert.equal(reset.tasks[1].dateManual, false);
  const after = (await fs.readJson(planPath(root, KEY))).tasks[1];
  assert.equal('dueDate' in after || 'dueDateManual' in after, false);
});

test('una fecha inválida se rechaza y exceder 8 h en un día no bloquea', async () => {
  const root = await seeded();
  await assert.rejects(updateTask(root, KEY, 'T1', { dueDate: '31/12' }), /Fecha inválida/);
  const model = await updateTask(root, KEY, 'T1', { finalEstimate: '9h' }, THURSDAY);
  assert.ok(model.daySeconds[THURSDAY] > model.dailyCapacitySeconds);
});

test('las tareas sin marcar no tienen fecha ni ocupan días', async () => {
  const root = await seeded();
  const model = await updateTask(root, KEY, 'T1', { include: false }, THURSDAY);
  assert.equal(model.tasks[0].effectiveDate, null);
  assert.deepEqual(model.daySeconds, { [THURSDAY]: 2 * ONE_HOUR });
});
