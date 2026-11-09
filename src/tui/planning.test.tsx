import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import {
  BASE_HEADER,
  createFakeChat,
  createFakePlan,
  createFakeTasks,
  FakeTasksOptions,
  waitFor,
} from './test-support.js';
import { FINISH_TEXTS, HOME_TEXTS, PLANNING_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const NO_ITEMS = async () => [];
const STORY = { key: 'AQ-45', summary: 'Login', phase: 'debate', block: 'riesgos', nextStep: 'Retoma', updatedAt: 't' };

function setup(options: FakeTasksOptions = {}) {
  const chat = createFakeChat();
  const fakeTasks = createFakeTasks(options);
  const utils = render(
    <App
      projectKey="AQ"
      stories={[STORY]}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={NO_ITEMS}
      fetchStories={NO_ITEMS}
      fetchProjects={NO_ITEMS}
      setProject={async () => ({ ok: true })}
      loadStories={async () => [STORY]}
      chat={chat.chat}
      plan={createFakePlan().plan}
      tasks={fakeTasks.tasks}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  // El chat abre con un primer turno; se deja terminar para poder salir con Esc
  const chatReady = async () => {
    await waitFor(() => chat.calls.opened.length === 1, 'el chat abierto');
    chat.emit({ type: 'turnEnd', header: BASE_HEADER });
    await tick();
  };
  return { ...utils, frame, press, has, chat, chatReady, ...fakeTasks };
}

test('al entrar pregunta por la Planificación; con n se entra al chat sin crear nada', async () => {
  const app = setup();
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  assert.equal(app.chat.calls.opened.length, 0, 'el chat espera la respuesta');
  await app.press('n');
  await app.chatReady();
  assert.equal(app.calls.planning.length, 0);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('con s propone la estimación y hoy; Enter la crea y al salir del chat pregunta si terminó', async () => {
  const app = setup();
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  await app.press('s');
  await app.has(PLANNING_TEXTS.formTitle('AQ-45'));
  assert.ok(app.frame().includes('1h') && app.frame().includes('hoy'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.chatReady();
  assert.deepEqual(app.calls.planning, [{ storyKey: 'AQ-45', input: { estimate: '1h', dueDate: 'hoy' } }]);
  await app.has(PLANNING_TEXTS.created('AQ-150'));
  await app.press(ESC);
  await app.has(FINISH_TEXTS.question('AQ-150'));
  await app.press('s');
  await app.has(HOME_TEXTS.title);
  assert.equal(app.calls.finished[0]?.key, 'AQ-150');
});

test('con una Planificación abierta no pregunta: avisa y al salir pregunta por esa', async () => {
  const app = setup({ planningOpen: 'AQ-140' });
  await app.press(ENTER);
  await app.chatReady();
  await app.has(PLANNING_TEXTS.stillOpen('AQ-140'));
  assert.ok(!app.frame().includes(PLANNING_TEXTS.question('AQ-45')));
  await app.press(ESC);
  await app.has(FINISH_TEXTS.question('AQ-140'));
  await app.press('n');
  await app.has(HOME_TEXTS.title);
  assert.equal(app.calls.finished.length, 0);
});

test('si Jira falla se ve el motivo y Enter entra al chat igual', async () => {
  const app = setup({ planningOutcome: { ok: false, message: 'No pude crear la Planificación: caído.' } });
  await app.press(ENTER);
  await app.has(PLANNING_TEXTS.question('AQ-45'));
  await app.press('s');
  await app.has(PLANNING_TEXTS.formTitle('AQ-45'));
  await app.press(ENTER);
  await app.press(ENTER);
  await app.has('caído');
  await app.press(ENTER);
  await app.chatReady();
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});
