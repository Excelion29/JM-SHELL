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
import { ANALYSIS_TEXTS, FINISH_TEXTS, HOME_TEXTS, POINTS_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const EPIC = { key: 'AQ-5', summary: 'Gestión del tablero', status: 'En curso' };
const ANALYSIS_ID = 'an-1';

const analysisRow = (name: string, block = '—'): StorySummary => ({
  key: ANALYSIS_ID,
  kind: 'analysis',
  summary: name,
  phase: 'fuentes',
  block,
  nextStep: 'Pulsa Enter para continuar el análisis.',
  updatedAt: 't',
});

interface SetupOptions extends FakeAnalysisOptions {
  projectKey?: string | null;
  withAnalysis?: boolean;
  block?: string;
  // Historias que se listan antes que el análisis
  stories?: StorySummary[];
}

function setup({ projectKey = 'AQ', withAnalysis = true, block, stories = [], ...options }: SetupOptions = {}) {
  const fakeAnalysis = createFakeAnalysis(options);
  const fakeTasks = createFakeTasks();
  const chat = createFakeChat();
  // El inicio relee la lista al volver: con el análisis ya creado aparece y ya borrado desaparece
  const list = (): StorySummary[] => [
    ...stories,
    ...((withAnalysis || fakeAnalysis.calls.created.length > 0) && fakeAnalysis.calls.removed.length === 0
      ? [analysisRow(fakeAnalysis.detail.name, block)]
      : []),
  ];
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
      loadStories={async () => list()}
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
  const chatOpened = () => waitFor(() => chat.calls.opened.length > 0, 'que abra el chat');
  return { ...utils, frame, press, has, chatOpened, fakeTasks, fakeChat: chat, ...fakeAnalysis };
}

test('el inicio muestra el análisis con la marca [análisis] y sin los datos de una historia', async () => {
  const app = setup();
  await app.has(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID} · Observaciones · fuentes`);
  assert.ok(!app.frame().includes(HOME_TEXTS.blockLabel), 'un análisis no tiene bloque');
});

test('el inicio muestra el bloque real del análisis cuando lo hay', async () => {
  const app = setup({ block: 'propuesta' });
  await app.has(
    `${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID} · Observaciones · fuentes · ${HOME_TEXTS.blockLabel}: propuesta`,
  );
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

test('Enter en un análisis pregunta por la tarea; sin gestión pide dónde, crea ahí y abre el chat del análisis', async () => {
  const app = setup();
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
  await app.chatOpened();
  assert.deepEqual(app.fakeChat.calls.opened, [ANALYSIS_ID]);
  assert.deepEqual(app.calls.tracking, [
    { id: ANALYSIS_ID, input: { estimate: '1h', dueDate: 'hoy' }, whereKey: 'AQ-5' },
  ]);
  await app.has(ANALYSIS_TEXTS.tracking.created('AQ-160'));
});

test('con d el inicio abre el detalle del análisis con sus fuentes y su tarea, sin chat', async () => {
  const app = setup({
    detail: {
      sources: [{ file: 'nota.md', origin: 'file', addedAt: 't' }],
      tracking: [{ issueKey: 'AQ-160', status: 'started' }],
    },
  });
  await app.press('d');
  await app.has(ANALYSIS_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  await app.has(ANALYSIS_TEXTS.sourcesTitle(1));
  await app.has('nota.md');
  await app.has(ANALYSIS_TEXTS.trackingLine('AQ-160', ANALYSIS_TEXTS.trackingStatus.started));
  assert.equal(app.fakeChat.calls.opened.length, 0);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
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
  await app.chatOpened();
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
  await app.chatOpened();
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
  await app.chatOpened();
  assert.equal(app.calls.tracking.length, 0);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('con n no registra; una tarea ya abierta no pregunta y avisa que sigues en ella', async () => {
  const declined = setup();
  await declined.press(ENTER);
  await declined.has(ANALYSIS_TEXTS.tracking.question('Observaciones', null));
  await declined.press('n');
  await declined.chatOpened();
  assert.equal(declined.calls.tracking.length, 0);

  const open = setup({ trackingOpen: 'AQ-150' });
  await open.press(ENTER);
  await open.has(ANALYSIS_TEXTS.tracking.stillOpen('AQ-150'));
  assert.ok(!open.frame().includes(ANALYSIS_TEXTS.tracking.question('Observaciones', null)));
});

test('al salir con una tarea abierta pregunta si terminó y finaliza sobre el análisis', async () => {
  const app = setup({ trackingOpen: 'AQ-150' });
  await app.press(ENTER);
  await app.chatOpened();
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
  const app = setup();
  await app.press('d');
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
  const app = setup({ addError: 'Escribe una ruta de archivo o pega texto.' });
  await app.press('d');
  await app.press('a');
  await app.has(ANALYSIS_TEXTS.addTitle);
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has('Escribe una ruta de archivo o pega texto.');
  await app.press(ESC);
  await app.has(ANALYSIS_TEXTS.sourcesTitle(0));
});

test('d sin un análisis bajo el cursor avisa en vez de no hacer nada', async () => {
  const app = setup({ withAnalysis: false });
  await app.has(HOME_TEXTS.title);
  await app.press('d');
  await app.has(HOME_TEXTS.pickAnalysis);
});

const DELETE_KEY = '\u001b[3~';
const DELETE_WORD = 'borrar';
const REMOVE_TEXTS = ANALYSIS_TEXTS.remove;
const STORY: StorySummary = {
  key: 'AQ-45',
  summary: 'Login social',
  phase: 'plan',
  phaseId: 'plan',
  block: '—',
  nextStep: 'Siguiente',
  updatedAt: 't',
};

// Primera tecla tras pintar una pantalla: se espera un tick para que no se pierda
async function homeReady(app: ReturnType<typeof setup>) {
  await app.has(HOME_TEXTS.title);
  await tick();
}

test('x sobre un análisis pide escribir borrar, borra y vuelve al inicio sin él', async () => {
  const app = setup({
    detail: { sources: [{ file: 'nota.md', origin: 'file', addedAt: 't' }], documented: true },
  });
  await homeReady(app);
  await app.press('x');
  await app.has(REMOVE_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  await app.has(REMOVE_TEXTS.sources(1));
  await app.has(REMOVE_TEXTS.documents(true));
  await tick();
  await app.press(DELETE_WORD);
  await app.press(ENTER);
  await app.has(REMOVE_TEXTS.done(ANALYSIS_ID));
  assert.deepEqual(app.calls.removed, [ANALYSIS_ID]);
  assert.ok(!app.frame().includes(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID}`));
});

test('la tecla Supr sobre un análisis también abre la confirmación', async () => {
  const app = setup();
  await homeReady(app);
  await app.press(DELETE_KEY);
  await app.has(REMOVE_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  await app.has(REMOVE_TEXTS.documents(false));
});

test('escribir otra cosa o Esc cancela: no borra nada y vuelve al inicio', async () => {
  const app = setup();
  await homeReady(app);
  await app.press('x');
  await app.has(REMOVE_TEXTS.prompt);
  await tick();
  await app.press('no');
  await app.press(ENTER);
  await app.has(REMOVE_TEXTS.mismatch);
  assert.equal(app.calls.removed.length, 0);
  await app.has(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID}`);

  await app.press('x');
  await app.has(REMOVE_TEXTS.prompt);
  await tick();
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
  assert.equal(app.calls.removed.length, 0);
});

test('si el puente se niega (tarea en Jira) el aviso lo dice y el análisis sigue en el inicio', async () => {
  const message = `${ANALYSIS_ID} tiene su tarea en Jira (AQ-160); no lo borro.`;
  const app = setup({ removeError: message });
  await homeReady(app);
  await app.press('x');
  await app.has(REMOVE_TEXTS.prompt);
  await tick();
  await app.press(DELETE_WORD);
  await app.press(ENTER);
  await app.has(message);
  await app.has(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID}`);
});

test('Supr sobre una historia avisa que solo se borran análisis y no abre nada', async () => {
  const app = setup({ withAnalysis: false, stories: [STORY] });
  await homeReady(app);
  await app.press(DELETE_KEY);
  await app.has(HOME_TEXTS.onlyAnalysisDeletable);
  assert.ok(!app.frame().includes(REMOVE_TEXTS.prompt));
});

test('r sobre un análisis explica que es para historias y remite a t en vez de no hacer nada', async () => {
  const app = setup();
  await app.has(`${HOME_TEXTS.analysisMarker} ${ANALYSIS_ID}`);
  await tick();
  await app.press('r');
  await app.has(HOME_TEXTS.analysisHasNoTasks);
  assert.ok(HOME_TEXTS.analysisHasNoTasks.length < 70);
  assert.ok(!app.frame().includes(POINTS_TEXTS.title(ANALYSIS_ID, 'Observaciones')));
});

test('t sobre una historia con plan sin crear en Jira explica que primero se crean con r', async () => {
  const app = setup({ withAnalysis: false, stories: [STORY] });
  await app.has(STORY.summary);
  await tick();
  await app.press('t');
  await app.has(HOME_TEXTS.tasksNotYet);
});
