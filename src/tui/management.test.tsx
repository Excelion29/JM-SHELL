import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import {
  BASE_HEADER,
  createFakeChat,
  createFakeManagement,
  createFakePlan,
  createFakeTasks,
  FakeManagementOptions,
  FakeTasksOptions,
  waitFor,
} from './test-support.js';
import { HOME_TEXTS, MANAGEMENT_TEXTS, PLANNING_TEXTS, PROJECT_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const DOWN = '\u001b[B';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const NO_ITEMS = async () => [];
const STORY = { key: 'AQ-45', summary: 'Login', phase: 'debate', block: 'riesgos', nextStep: 'Retoma', updatedAt: 't' };
const EPICS = [
  { key: 'AQ-7', summary: 'Gestión del tablero', status: 'En curso' },
  { key: 'AQ-8', summary: 'Otra épica', status: 'En curso' },
];

interface SetupOptions {
  projectKey?: string | null;
  management?: FakeManagementOptions;
  tasks?: FakeTasksOptions;
  story?: typeof STORY;
}

function setup({ projectKey = 'AQ', management = {}, tasks = {}, story = STORY }: SetupOptions = {}) {
  const chat = createFakeChat();
  const fakeTasks = createFakeTasks(tasks);
  const fakeManagement = createFakeManagement(management);
  const utils = render(
    <App
      projectKey={projectKey}
      stories={[story]}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={async () => EPICS}
      fetchStories={NO_ITEMS}
      fetchProjects={async () => [{ key: 'AQ', name: 'Aquí' }]}
      setProject={async () => ({ ok: true })}
      loadStories={async () => [story]}
      chat={chat.chat}
      plan={createFakePlan().plan}
      tasks={fakeTasks.tasks}
      management={fakeManagement.management}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  // Los textos largos se parten en líneas dentro del marco: se compara sin saltos ni bordes
  const flat = () =>
    frame()
      .replace(/[│╭╮╰╯─]/g, ' ')
      .replace(/\s+/g, ' ');
  const has = (text: string) => waitFor(() => flat().includes(text), `"${text}"`);
  const chatReady = async () => {
    await waitFor(() => chat.calls.opened.length === 1, 'el chat abierto');
    chat.emit({ type: 'turnEnd', header: BASE_HEADER });
    await tick();
  };
  return { ...utils, frame, flat, press, has, chat, chatReady, tasks: fakeTasks, management: fakeManagement };
}

test('tras elegir proyecto con p pregunta por la gestión; n la guarda como "no tiene" y vuelve al inicio', async () => {
  const app = setup({ projectKey: null });
  await app.press('p');
  await app.has(PROJECT_TEXTS.title);
  await app.press(ENTER);
  await app.has(MANAGEMENT_TEXTS.question);
  await app.press('n');
  await app.has(HOME_TEXTS.title);
  assert.deepEqual(app.management.calls.saved, [{ projectKey: 'AQ', key: null }]);
});

test('tras elegir proyecto no vuelve a preguntar si ya respondió', async () => {
  const app = setup({ projectKey: null, management: { status: { AQ: 'none' } } });
  await app.press('p');
  await app.has(PROJECT_TEXTS.title);
  await app.press(ENTER);
  // El inicio ya se veía antes: se espera a que se haya consultado la gestión del proyecto elegido
  await waitFor(() => app.management.calls.statusReads.includes('AQ'), 'la lectura de la gestión');
  await app.has(HOME_TEXTS.title);
  assert.ok(!app.frame().includes(MANAGEMENT_TEXTS.question));
  assert.equal(app.management.calls.saved.length, 0);
});

test('al entrar a una historia sin respuesta pregunta antes de la Planificación; n guarda null', async () => {
  const app = setup();
  await app.press(ENTER);
  await app.has(MANAGEMENT_TEXTS.question);
  assert.equal(app.chat.calls.opened.length, 0, 'el chat espera la respuesta');
  await app.press('n');
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  assert.deepEqual(app.management.calls.saved, [{ projectKey: 'AQ', key: null }]);
});

test('con null guardado no vuelve a preguntar al entrar a otra historia', async () => {
  const app = setup();
  await app.press(ENTER);
  await app.has(MANAGEMENT_TEXTS.question);
  await app.press('n');
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  await app.press('n');
  await app.chatReady();
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  assert.ok(!app.frame().includes(MANAGEMENT_TEXTS.question));
  assert.equal(app.management.calls.saved.length, 1);
});

test('Esc al entrar a una historia sigue a la Planificación sin guardar: la próxima vez vuelve a preguntar', async () => {
  const app = setup();
  await app.press(ENTER);
  await app.has(MANAGEMENT_TEXTS.question);
  await app.press(ESC);
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  assert.equal(app.management.calls.saved.length, 0);
});

test('con gestión guardada la Planificación dice dónde irá y no se pregunta de nuevo', async () => {
  const app = setup({
    management: { status: { AQ: { key: 'AQ-7', summary: 'Gestión' } } },
    tasks: { managementKey: 'AQ-7' },
  });
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('AQ-45', 'AQ-7'));
  assert.ok(app.flat().includes(PLANNING_TEXTS.whyManagement('AQ-7', 'AQ-45')));
  assert.ok(!app.frame().includes(MANAGEMENT_TEXTS.question));
});

test('si la de gestión no sirvió, el aviso de la Planificación pide cambiarla con g', async () => {
  const app = setup({
    management: { status: { AQ: { key: 'AQ-7', summary: 'Gestión' } } },
    tasks: {
      managementKey: 'AQ-7',
      planningOutcome: {
        ok: true,
        issueKey: 'AQ-150',
        started: true,
        fallback: { key: 'AQ-7', reason: 'done', message: 'AQ-7 ya está finalizada.' },
      },
    },
  });
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('AQ-45', 'AQ-7'));
  await app.press('s');
  await app.has(PLANNING_TEXTS.formTitle('AQ-45'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.chatReady();
  await app.has('La de gestión AQ-7 ya no sirve');
});

test('g en el inicio muestra la actual; s lista las épicas y Enter guarda la elegida', async () => {
  const app = setup({ management: { status: { AQ: { key: 'AQ-3', summary: 'Vieja' } } } });
  await app.press('g');
  await app.has(MANAGEMENT_TEXTS.question);
  assert.ok(app.frame().includes('AQ-3 · Vieja'));
  await app.press('s');
  await app.has('AQ-8 Otra épica');
  await app.press(DOWN);
  await app.press(ENTER);
  await app.has(HOME_TEXTS.title);
  assert.deepEqual(app.management.calls.saved, [{ projectKey: 'AQ', key: 'AQ-8' }]);
});

test('g, s y k permiten escribir la clave de una historia', async () => {
  const app = setup();
  await app.press('g');
  await app.has(MANAGEMENT_TEXTS.question);
  await app.press('s');
  await app.has(EPICS[0].summary);
  await app.press('k');
  await app.press('aq-9');
  await app.press(ENTER);
  await app.has(HOME_TEXTS.title);
  assert.deepEqual(app.management.calls.saved, [{ projectKey: 'AQ', key: 'AQ-9' }]);
});

test('si Jira rechaza la clave se ve el motivo y no se sale ni se guarda', async () => {
  const app = setup({ management: { saveError: 'AQ-7 ya está finalizada.' } });
  await app.press('g');
  await app.has(MANAGEMENT_TEXTS.question);
  await app.press('s');
  await app.has(EPICS[0].summary);
  await app.press(ENTER);
  await app.has(MANAGEMENT_TEXTS.saveError('AQ-7 ya está finalizada.'));
  assert.ok(!app.frame().includes(HOME_TEXTS.title));
});

test('g sin proyecto avisa que primero se elige uno', async () => {
  const app = setup({ projectKey: null });
  await app.press('g');
  await app.has(MANAGEMENT_TEXTS.needsProject);
  assert.equal(app.management.calls.saved.length, 0);
});

test('Esc en g vuelve al inicio sin guardar', async () => {
  const app = setup();
  await app.press('g');
  await app.has(MANAGEMENT_TEXTS.question);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
  assert.equal(app.management.calls.saved.length, 0);
});

test('al entrar a una historia de otro proyecto se pregunta y guarda por el proyecto de la historia', async () => {
  const app = setup({ story: { ...STORY, key: 'XY-5' } });
  await app.press(ENTER);
  await app.has(MANAGEMENT_TEXTS.title);
  assert.ok(app.management.calls.statusReads.every((project) => project === 'XY'));
  await app.press('n');
  await app.has(PLANNING_TEXTS.question('XY-5'));
  assert.deepEqual(app.management.calls.saved, [{ projectKey: 'XY', key: null }]);
});

test('si el proyecto de la historia ya respondió no pregunta aunque el de la app no', async () => {
  const app = setup({ story: { ...STORY, key: 'XY-5' }, management: { status: { XY: 'none' } } });
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('XY-5'));
  assert.ok(!app.frame().includes(MANAGEMENT_TEXTS.question));
  assert.deepEqual(app.management.calls.statusReads, ['XY']);
});
