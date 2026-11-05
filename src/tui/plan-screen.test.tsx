import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import type { StorySummary } from '../refinement/types.js';
import { App } from './app.js';
import { createFakeChat, createFakePlan, FAKE_TARGET, FakePlanOptions, fakeTask, waitFor } from './test-support.js';
import { CLOSE_TEXTS, CREATE_TEXTS, HOME_TEXTS, PLAN_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const DOWN = '\u001b[B';
const UP = String.fromCharCode(27) + '[A';
const BACKSPACE = '\u007f';
const SPACE = ' ';
const TICK_MS = 30;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

const story = (phaseId: StorySummary['phaseId'], phase = phaseId as string): StorySummary => ({
  key: 'AQ-45',
  summary: 'Login social',
  phase,
  phaseId,
  block: '—',
  nextStep: 'Siguiente',
  updatedAt: '2026-11-04T10:00:00.000Z',
});

const NO_ITEMS = async () => [];

function setup(planOptions: FakePlanOptions = {}, phaseId: StorySummary['phaseId'] = 'plan') {
  const fakePlan = createFakePlan(planOptions);
  const stories = [story(phaseId)];
  const utils = render(
    <App
      projectKey="AQ"
      stories={stories}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={NO_ITEMS}
      fetchStories={NO_ITEMS}
      fetchProjects={NO_ITEMS}
      setProject={async () => ({ ok: true })}
      loadStories={async () => stories}
      chat={createFakeChat().chat}
      plan={fakePlan.plan}
    />,
  );
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const frame = () => utils.lastFrame() ?? '';
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  return { ...utils, press, frame, has, ...fakePlan };
}

async function openReview(planOptions: FakePlanOptions = {}) {
  const app = setup(planOptions);
  await app.press('r');
  await app.has(PLAN_TEXTS.title('AQ-45', 'Login social'));
  return app;
}

test('r abre la revisión solo con la historia en plan o revisado', async () => {
  const debate = setup({}, 'debate');
  await debate.press('r');
  assert.ok(debate.frame().includes(HOME_TEXTS.title));

  const app = await openReview();
  const frame = app.frame();
  assert.ok(frame.includes('[x] T1') && frame.includes('[x] T2'));
  assert.ok(frame.includes('O 30m M 1h P 2h'));
  assert.ok(frame.includes('~1h5m'));
  assert.ok(frame.includes('medio'));
  assert.ok(frame.includes(PLAN_TEXTS.total(2, '3h5m', '33m')));
});

test('espacio marca o desmarca la tarea y cambia el total, guardando al instante', async () => {
  const app = await openReview();
  await app.press(SPACE);
  await app.has('[ ] T1');
  assert.ok(app.frame().includes(PLAN_TEXTS.total(1, '2h', '30m')));
  assert.deepEqual(app.calls.updates, [{ taskId: 'T1', patch: { include: false } }]);
});

test('e edita O/M/P con recálculo en vivo y guarda solo si es válido', async () => {
  const app = await openReview();
  await app.press('e');
  await app.has(PLAN_TEXTS.editTitle('T1'));
  await app.press(ENTER);
  for (let i = 0; i < 3; i++) await app.press(BACKSPACE);
  await app.press('2h');
  await app.has('Debe cumplirse');
  await app.press(ENTER);
  await app.press(ENTER);
  await app.press(ENTER);
  assert.equal(app.calls.updates.length, 0);

  await app.press(UP);
  await app.press(UP);
  for (let i = 0; i < 2; i++) await app.press(BACKSPACE);
  await app.press('1h');
  await app.has(PLAN_TEXTS.preview('1h10m', '10m'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(PLAN_TEXTS.title('AQ-45', 'Login social'));
  assert.equal(app.calls.updates.length, 1);
  assert.deepEqual(app.calls.updates[0].patch.estimate, { optimistic: '1h', likely: '1h', pessimistic: '2h' });
});

test('e permite cambiar el título y Esc descarta', async () => {
  const app = await openReview();
  await app.press('e');
  await app.press('!');
  await app.press(ESC);
  await app.has(PLAN_TEXTS.title('AQ-45', 'Login social'));
  assert.equal(app.calls.updates.length, 0);
});

test('d muestra descripción, criterio, porqué y adjuntos de la tarea', async () => {
  const app = await openReview({ files: [{ file: 'captura.png', purpose: 'evidence', taskIds: ['T1'] }] });
  await app.press('d');
  await app.has(PLAN_TEXTS.detailDescription);
  const frame = app.frame();
  assert.ok(frame.includes('Detalle de T1') && frame.includes('- Pasa el test') && frame.includes('Parecido a AQ-10'));
  assert.ok(frame.includes('captura.png (evidencia)'));
  await app.press(ESC);
  await app.has(PLAN_TEXTS.title('AQ-45', 'Login social'));
});

test('a cambia el propósito con espacio y asigna tareas con Enter', async () => {
  const app = await openReview({ files: [{ file: 'captura.png', purpose: 'analysis', taskIds: [] }] });
  await app.press('a');
  await app.has('captura.png · análisis → sin tarea');
  await app.press(SPACE);
  await app.has('captura.png · evidencia → sin tarea');
  await app.press(ENTER);
  await app.has(PLAN_TEXTS.fileTasksTitle('captura.png'));
  await app.press(DOWN);
  await app.press(SPACE);
  await app.press(ESC);
  await app.has('captura.png · evidencia → T2');
  assert.deepEqual(app.calls.purposes, [{ file: 'captura.png', purpose: 'evidence' }]);
  assert.deepEqual(app.calls.toggles, [{ file: 'captura.png', taskId: 'T2' }]);
  await app.press('o');
  assert.deepEqual(app.calls.openedFiles, ['captura.png']);
});

test('c sin tareas marcadas avisa y no abre la creación', async () => {
  const app = await openReview({ tasks: [fakeTask('T1', { include: false })] });
  await app.press('c');
  await app.has(PLAN_TEXTS.noneIncluded);
});

const CREATED = [
  { taskId: 'T1', key: 'AQ-101', summary: 'Tarea T1', existing: false },
  { taskId: 'T2', key: 'AQ-102', summary: 'Tarea T2', existing: true },
];

test('c muestra el resumen, s crea con progreso y o abre el padre', async () => {
  const app = await openReview({
    preview: { uploads: [{ file: 'captura.png', purpose: 'evidence', taskIds: ['T1'] }] },
    progress: [{ index: 1, total: 2, summary: 'Tarea T1', step: 'created', detail: 'AQ-101' }],
    outcomes: [{ ok: true, created: CREATED, parentKey: 'AQ-45', estimateSkipped: false }],
  });
  await app.press('c');
  await app.has(CREATE_TEXTS.confirmTitle);
  const frame = app.frame();
  assert.ok(frame.includes(CREATE_TEXTS.tasks(2, '3h5m')));
  assert.ok(frame.includes('Padre: AQ-45 · Login social') && frame.includes('Tipo: Subtarea'));
  assert.ok(frame.includes('Responsable: Marcello Cano') && frame.includes('Adjuntos a subir: 1'));
  assert.ok(frame.includes('captura.png (evidencia) → T1'));
  assert.equal(app.calls.created.length, 0);

  await app.press('s');
  await app.has(CREATE_TEXTS.doneTitle);
  assert.ok(app.frame().includes('AQ-101 · Tarea T1') && app.frame().includes('AQ-102 · Tarea T2 (ya estaba)'));
  assert.deepEqual(app.calls.created, [{ target: FAKE_TARGET, assigneeId: 'acc-1', adopt: {} }]);
  await app.press('o');
  assert.deepEqual(app.calls.opened, ['AQ-45']);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('Esc en la confirmación cancela sin crear nada', async () => {
  const app = await openReview();
  await app.press('c');
  await app.has(CREATE_TEXTS.confirmTitle);
  await app.press(ESC);
  await app.has(PLAN_TEXTS.title('AQ-45', 'Login social'));
  assert.equal(app.calls.created.length, 0);
});

test('a en la confirmación cambia el responsable para todas las tareas', async () => {
  const app = await openReview({
    outcomes: [{ ok: true, created: CREATED, parentKey: 'AQ-45', estimateSkipped: false }],
  });
  await app.press('c');
  await app.has(CREATE_TEXTS.confirmTitle);
  await app.press('a');
  await app.has(CREATE_TEXTS.assigneeTitle);
  await app.press('Ana');
  await app.press(ENTER);
  await app.has('Responsable: Ana Pérez');
  await app.press('s');
  await app.has(CREATE_TEXTS.doneTitle);
  assert.equal(app.calls.created[0].assigneeId, 'acc-2');
});

test('una falla a medias muestra el mensaje y r continúa', async () => {
  const app = await openReview({
    outcomes: [
      { ok: false, message: 'Jira API error (500): caído', created: [CREATED[0]] },
      { ok: true, created: CREATED, parentKey: 'AQ-45', estimateSkipped: false },
    ],
  });
  await app.press('c');
  await app.press('s');
  await app.has(CREATE_TEXTS.failedTitle);
  assert.ok(app.frame().includes('Jira API error (500): caído'));
  assert.ok(app.frame().includes(CREATE_TEXTS.failedKept(1)));
  await app.press('r');
  await app.has(CREATE_TEXTS.doneTitle);
  assert.equal(app.calls.created.length, 2);
});

test('sin padre válido (épica) pregunta dónde crear y usa la épica elegida', async () => {
  const epicTarget = {
    ...FAKE_TARGET,
    parentKey: 'AQ-1',
    parentSummary: 'Pagos',
    childKind: 'standard' as const,
    issueTypeName: 'Tarea',
  };
  const app = await openReview({
    preview: { parent: { kind: 'ask', reason: 'epic', epicKey: 'AQ-1', epicSummary: 'Pagos' } },
    targets: { 'AQ-1': { ok: true, target: epicTarget } },
    outcomes: [{ ok: true, created: CREATED, parentKey: 'AQ-1', estimateSkipped: false }],
  });
  await app.press('c');
  await app.has(CREATE_TEXTS.askQuestion);
  assert.ok(app.frame().includes(CREATE_TEXTS.askReasons.epic('AQ-45')));
  assert.equal(app.calls.created.length, 0);
  await app.press(ENTER);
  await app.has(CREATE_TEXTS.confirmTitle);
  assert.ok(app.frame().includes('Padre: AQ-1 · Pagos') && app.frame().includes('Tipo: Tarea'));
  await app.press('s');
  await app.has(CREATE_TEXTS.doneTitle);
  assert.equal(app.calls.created[0].target.parentKey, 'AQ-1');
});

test('sin padre válido permite escribir otra clave, valida y vuelve a preguntar si no sirve', async () => {
  const app = await openReview({
    preview: { parent: { kind: 'ask', reason: 'done', epicKey: null, epicSummary: null } },
    targets: { 'AQ-12': { ok: true, target: { ...FAKE_TARGET, parentKey: 'AQ-12', parentSummary: 'Otra' } } },
  });
  await app.press('c');
  await app.has(CREATE_TEXTS.askReasons.done('AQ-45'));
  assert.ok(!app.frame().includes('épica AQ'));
  await app.press(ENTER);
  await app.press('mala');
  await app.press(ENTER);
  assert.equal(app.calls.resolved.length, 0);
  await app.press(ESC);
  await app.press(ENTER);
  await app.press('aq-99');
  await app.press(ENTER);
  await app.has(CREATE_TEXTS.otherError('No encontré AQ-99 en Jira.'));
  await app.press(ENTER);
  await app.press('aq-12');
  await app.press(ENTER);
  await app.has('Padre: AQ-12 · Otra');
  assert.deepEqual(app.calls.resolved, ['AQ-99', 'AQ-12']);
});

const CLOSE_PREVIEW = {
  deletable: [
    { file: 'notas.txt', reason: 'solo era para el análisis' },
    { file: 'captura.png', reason: 'verificado en AQ-101 (mismo nombre y tamaño)' },
  ],
  kept: [{ file: 'log.txt', reason: 'no se subió a ningún issue' }],
};

test('x muestra qué se borra y qué se conserva; una tecla distinta de s cancela sin borrar', async () => {
  const app = setup({ closePreview: CLOSE_PREVIEW }, 'created');
  await app.press('x');
  await app.has(CLOSE_TEXTS.title('AQ-45'));
  const frame = app.frame();
  assert.ok(frame.includes('notas.txt · solo era para el análisis'));
  assert.ok(frame.includes('captura.png · verificado en AQ-101'));
  assert.ok(frame.includes('log.txt · no se subió a ningún issue'));
  await app.press('n');
  await app.has(HOME_TEXTS.title);
  assert.deepEqual(app.calls.closed, []);
});

test('x y s borran solo la lista mostrada y confirman el cierre', async () => {
  const app = setup(
    { closePreview: CLOSE_PREVIEW, closeResult: { deleted: ['notas.txt', 'captura.png'], kept: CLOSE_PREVIEW.kept } },
    'in-progress',
  );
  await app.press('x');
  await app.has(CLOSE_TEXTS.question);
  await app.press('s');
  await app.has(CLOSE_TEXTS.doneTitle);
  assert.deepEqual(app.calls.closed, [['notas.txt', 'captura.png']]);
  assert.ok(app.frame().includes(CLOSE_TEXTS.doneDeleted(2)) && app.frame().includes(CLOSE_TEXTS.doneKept(1)));
});

test('x no hace nada si la historia aún no tiene tareas creadas', async () => {
  const app = setup({}, 'plan');
  await app.press('x');
  assert.ok(app.frame().includes(HOME_TEXTS.title));
  assert.equal(app.calls.prepareClose, 0);
});

test('la confirmación muestra lo que ya existe y solo con s se vincula', async () => {
  const existing = [{ taskId: 'T2', key: 'AQ-7', summary: 'Tarea T2' }];
  const app = await openReview({
    preview: { existing },
    outcomes: [{ ok: true, created: CREATED, parentKey: 'AQ-45', estimateSkipped: false }],
  });
  await app.press('c');
  await app.has(CREATE_TEXTS.existingHeader);
  assert.ok(app.frame().includes(CREATE_TEXTS.existingLine('AQ-7', 'Tarea T2').trim()));
  assert.equal(app.calls.created.length, 0);
  await app.press(ESC);
  await app.has(PLAN_TEXTS.title('AQ-45', 'Login social'));
  assert.equal(app.calls.created.length, 0);
  await app.press('c');
  await app.press('s');
  await app.has(CREATE_TEXTS.doneTitle);
  assert.deepEqual(app.calls.created[0].adopt, { T2: 'AQ-7' });
});
