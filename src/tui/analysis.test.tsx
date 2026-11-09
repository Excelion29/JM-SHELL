import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import type { StorySummary } from '../refinement/types.js';
import {
  createFakeAnalysis,
  createFakeChat,
  createFakePlan,
  createFakeTasks,
  type FakeAnalysisOptions,
  waitFor,
} from './test-support.js';
import { ANALYSIS_TEXTS, FINISH_TEXTS, HOME_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const EPIC = { key: 'AQ-5', summary: 'Gestión del tablero', status: 'En curso' };
const ANALYSIS_ID = 'an-1';

const analysisRow = (name: string): StorySummary => ({
  key: ANALYSIS_ID,
  kind: 'analysis',
  summary: name,
  phase: 'fuentes',
  block: '—',
  nextStep: 'Pulsa Enter para continuar el análisis.',
  updatedAt: 't',
});

interface SetupOptions extends FakeAnalysisOptions {
  projectKey?: string | null;
  withAnalysis?: boolean;
}

function setup({ projectKey = 'AQ', withAnalysis = true, ...options }: SetupOptions = {}) {
  const fakeAnalysis = createFakeAnalysis(options);
  const fakeTasks = createFakeTasks();
  const chat = createFakeChat();
  // El inicio relee la lista al volver: con el análisis ya creado aparece
  const list = (): StorySummary[] => (withAnalysis ? [analysisRow(fakeAnalysis.detail.name)] : []);
  const utils = render(
    <App
      projectKey={projectKey}
      stories={list()}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={async () => [EPIC]}
      fetchStories={async () => []}
      fetchProjects={async () => []}
      setProject={async () => ({ ok: true })}
      loadStories={async () => (withAnalysis || fakeAnalysis.calls.created.length > 0 ? [analysisRow(fakeAnalysis.detail.name)] : [])}
      chat={chat.chat}
      plan={createFakePlan().plan}
      tasks={fakeTasks.tasks}
      analysis={fakeAnalysis.analysis}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  return { ...utils, frame, press, has, fakeTasks, ...fakeAnalysis };
}

test('el inicio muestra el análisis con la marca [análisis] y sin los datos de una historia', async () => {
  const app = setup();
  await app.has(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID} · Observaciones · fuentes`);
  assert.ok(!app.frame().includes(HOME_TEXTS.blockLabel), 'un análisis no tiene bloque');
});

test('con a se crea un análisis: nombre, archivos y texto; muestra el resultado de cada archivo y vuelve al inicio con él', async () => {
  const app = setup({
    withAnalysis: false,
    results: [
      { source: 'C:\\x\\a.md', ok: true, file: 'a.md' },
      { source: 'C:\\x\\b.exe', ok: false, message: 'tipo no admitido (.exe)' },
    ],
  });
  await app.has(HOME_TEXTS.empty);
  await app.press('a');
  await app.has(ANALYSIS_TEXTS.newTitle);
  await app.press('Observaciones');
  await app.press(ENTER);
  await app.press('C:\\x\\a.md; C:\\x\\b.exe');
  await app.press(ENTER);
  await app.press('texto pegado');
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.created(ANALYSIS_ID, 'Observaciones'));
  assert.deepEqual(app.calls.created, [
    { name: 'Observaciones', paths: 'C:\\x\\a.md; C:\\x\\b.exe', text: 'texto pegado' },
  ]);
  await app.has(ANALYSIS_TEXTS.resultOk('C:\\x\\a.md', 'a.md'));
  await app.has(ANALYSIS_TEXTS.resultFailed('C:\\x\\b.exe', 'tipo no admitido (.exe)'));
  await app.press(ENTER);
  await app.has(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID} · Observaciones`);
});

test('el nombre es obligatorio: sin él no se crea y se avisa', async () => {
  const app = setup({ withAnalysis: false });
  await app.press('a');
  await app.has(ANALYSIS_TEXTS.newTitle);
  await app.press(ENTER);
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.nameRequired);
  assert.equal(app.calls.created.length, 0);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('un error al crear se muestra en el formulario y no se pierde el análisis', async () => {
  const app = setup({ withAnalysis: false, createError: 'Aún no hay un proyecto elegido.' });
  await app.press('a');
  await app.press('Algo');
  await app.press(ENTER);
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has('Aún no hay un proyecto elegido.');
  await app.has(ANALYSIS_TEXTS.newTitle);
});

test('sin proyecto elegido a avisa y no abre el formulario', async () => {
  const app = setup({ projectKey: null, withAnalysis: false });
  await app.press('a');
  await app.has(HOME_TEXTS.needsProjectForAnalysis);
  assert.ok(!app.frame().includes(ANALYSIS_TEXTS.newTitle));
});

test('Enter en un análisis pregunta por la tarea; sin gestión pide dónde, crea ahí y muestra el detalle con fuentes y tarea', async () => {
  const app = setup({
    detail: { sources: [{ file: 'nota.md', origin: 'file', addedAt: 't' }] },
  });
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.tracking.question('Observaciones', null));
  assert.equal(app.calls.tracking.length, 0);
  await app.press('s');
  await app.has(ANALYSIS_TEXTS.tracking.whereTitle);
  await app.has(EPIC.key);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.tracking.formTitle('Observaciones'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  assert.deepEqual(app.calls.tracking, [
    { id: ANALYSIS_ID, input: { estimate: '1h', dueDate: 'hoy' }, whereKey: 'AQ-5' },
  ]);
  await app.has(ANALYSIS_TEXTS.sourcesTitle(1));
  await app.has('nota.md');
  await app.has(ANALYSIS_TEXTS.trackingLine('AQ-160', ANALYSIS_TEXTS.trackingStatus.started));
  await app.has(ANALYSIS_TEXTS.tracking.created('AQ-160'));
});

test('con gestión configurada no pregunta dónde: va directo al formulario y crea en la gestión', async () => {
  const app = setup({ managementKey: 'AQ-9' });
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.tracking.question('Observaciones', 'AQ-9'));
  await app.press('s');
  await app.has(ANALYSIS_TEXTS.tracking.formTitle('Observaciones'));
  assert.ok(!app.frame().includes(ANALYSIS_TEXTS.tracking.whereTitle));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  assert.equal(app.calls.tracking[0].whereKey, null);
});

test('si la de gestión no sirve vuelve a preguntar dónde con el motivo y no pide otra vez la estimación', async () => {
  const app = setup({
    managementKey: 'AQ-9',
    trackingOutcomes: [{ ok: false, message: 'La de gestión AQ-9 no sirve: ya está finalizada.', askWhere: true }],
  });
  await app.press(ENTER);
  await app.press('s');
  await app.has(ANALYSIS_TEXTS.tracking.formTitle('Observaciones'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.tracking.whereProblem('La de gestión AQ-9 no sirve: ya está finalizada.'));
  await app.has(ANALYSIS_TEXTS.tracking.whereTitle);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.tracking.formTitle('Observaciones'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  assert.deepEqual(
    app.calls.tracking.map((c) => c.whereKey),
    [null, 'AQ-5'],
  );
});

test('Esc al elegir dónde es no registrar: entra al análisis sin crear nada', async () => {
  const app = setup();
  await app.press(ENTER);
  await app.press('s');
  await app.has(ANALYSIS_TEXTS.tracking.whereTitle);
  await app.press(ESC);
  await app.has(ANALYSIS_TEXTS.noTracking);
  assert.equal(app.calls.tracking.length, 0);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('con n no registra; una tarea ya abierta no pregunta y avisa que sigues en ella', async () => {
  const declined = setup();
  await declined.press(ENTER);
  await declined.has(ANALYSIS_TEXTS.tracking.question('Observaciones', null));
  await declined.press('n');
  await declined.has(ANALYSIS_TEXTS.noTracking);
  assert.equal(declined.calls.tracking.length, 0);

  const open = setup({ trackingOpen: 'AQ-150' });
  await open.press(ENTER);
  await open.has(ANALYSIS_TEXTS.tracking.stillOpen('AQ-150'));
  assert.ok(!open.frame().includes(ANALYSIS_TEXTS.tracking.question('Observaciones', null)));
});

test('al salir con una tarea abierta pregunta si terminó y finaliza sobre el análisis', async () => {
  const app = setup({ trackingOpen: 'AQ-150' });
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  await app.press(ESC);
  await app.has(FINISH_TEXTS.question('AQ-150'));
  await app.press('s');
  await app.has(FINISH_TEXTS.done('AQ-150'));
  assert.deepEqual(
    app.fakeTasks.calls.finished.map((c) => c.key),
    ['AQ-150'],
  );
  await app.has(HOME_TEXTS.title);
});

test('en el detalle, a agrega más fuentes y la lista se actualiza', async () => {
  const app = setup({ trackingOpen: 'AQ-150' });
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.noSourcesYet);
  await app.press('a');
  await app.has(ANALYSIS_TEXTS.addTitle);
  await app.press('C:\\x\\nueva.md');
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.added);
  assert.deepEqual(app.calls.added, [{ id: ANALYSIS_ID, input: { paths: 'C:\\x\\nueva.md', text: '' } }]);
  await app.press(ENTER);
  await app.has(ANALYSIS_TEXTS.sourcesTitle(1));
  await app.has('C:\\x\\nueva.md');
});

test('al agregar fuentes un error se muestra y se puede cancelar con Esc', async () => {
  const app = setup({ trackingOpen: 'AQ-150', addError: 'Escribe una ruta de archivo o pega texto.' });
  await app.press(ENTER);
  await app.press('a');
  await app.has(ANALYSIS_TEXTS.addTitle);
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has('Escribe una ruta de archivo o pega texto.');
  await app.press(ESC);
  await app.has(ANALYSIS_TEXTS.sourcesTitle(0));
});
