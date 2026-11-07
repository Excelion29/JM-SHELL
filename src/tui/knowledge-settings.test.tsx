import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { createFakeChat, createFakePlan, FakeKnowledge, FAKE_SETTINGS, waitFor } from './test-support.js';
import { HOME_TEXTS, KEYS, KNOWLEDGE_SETTINGS_TEXTS as T, KNOWLEDGE_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '';
const TICK_MS = 30;
const SETTLE_PASSES = 3;
const NEW_KEY = 'nueva-key-de-prueba';

const NO_ITEMS = async () => [];
const baseProps = {
  plan: createFakePlan().plan,
  unlock: async () => ({ ok: true }),
  fetchEpics: NO_ITEMS,
  fetchStories: NO_ITEMS,
  fetchProjects: NO_ITEMS,
  setProject: async () => ({ ok: true }),
};

const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
// Ink suscribe useInput en un efecto posterior al render: sin ceder el turno, la tecla se pierde
const settle = async () => {
  for (let i = 0; i < SETTLE_PASSES; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function openHome(knowledge: FakeKnowledge, projectKey: string | null = 'AQ') {
  const fake = createFakeChat({}, [], knowledge);
  const loads: Array<string | null> = [];
  const view = render(
    <App
      projectKey={projectKey}
      stories={[]}
      unlocked
      {...baseProps}
      loadStories={async (key) => (loads.push(key), [])}
      chat={fake.chat}
    />,
  );
  const frame = () => view.lastFrame() ?? '';
  const type = async (text: string) => {
    await settle();
    view.stdin.write(text);
    await tick();
  };
  const waitText = async (text: string) => {
    await waitFor(() => frame().includes(text), `"${text}"`);
    await settle();
  };
  return { fake, loads, type, frame, waitText };
}

test('b sin proyecto explica que hace falta uno y no abre la pantalla', async () => {
  const { type, waitText, frame } = openHome({}, null);
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.needsProject);
  assert.ok(!frame().includes(T.title));
});

test('b muestra la configuración actual y las cuatro acciones; Esc vuelve al inicio', async () => {
  const { type, waitText, frame } = openHome({});
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.connectionOk);
  for (const text of [
    T.type('mcp'),
    T.target('mcp', FAKE_SETTINGS.target ?? ''),
    T.base(FAKE_SETTINGS.baseFolder ?? ''),
    T.adr('06-JM-ADR'),
    ...Object.values(T.actions),
  ])
    assert.ok(frame().includes(text), text);
  await type(ESC);
  await waitText(HOME_TEXTS.title);
});

test('cambiar la carpeta base guarda con la conexión actual, avisa de lo que queda y recarga el inicio', async () => {
  const listings = {
    '': { entries: [{ name: 'OTRA', isFolder: true }], adrFolder: '00-JM-ADR' },
    OTRA: { entries: [], adrFolder: '00-JM-ADR' },
  };
  const { fake, loads, type, waitText, frame } = openHome({ listings, changeResult: { leftBehind: 3 } });
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.connectionOk);
  const loadsBefore = loads.length;
  await type('1');
  await waitText('OTRA');
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.browseEmpty);
  await type(KEYS.selectFolder);
  await waitText(T.leftBehind(3));
  assert.deepEqual(fake.calls.changed, [{ type: 'connect', connection: { type: 'current' }, baseFolder: 'OTRA' }]);
  assert.deepEqual(fake.calls.listed[0].connection, { type: 'current' });
  assert.ok(frame().includes(T.changed));
  await waitFor(() => loads.length > loadsBefore, 'la recarga de historias');
});

test('quitar la base pide confirmación y guarda none', async () => {
  const { fake, type, waitText } = openHome({ changeResult: { leftBehind: 1 } });
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.connectionOk);
  await type('3');
  await waitText(T.removeQuestion);
  await type('x');
  await waitText(T.connectionOk);
  assert.equal(fake.calls.changed.length, 0);
  await type('3');
  await waitText(T.removeQuestion);
  await type(KEYS.confirmYes);
  await waitText(T.leftBehind(1));
  assert.deepEqual(fake.calls.changed, [{ type: 'none' }]);
});

test('renovar la API key la envía al puente y muestra el resultado', async () => {
  const { fake, type, waitText } = openHome({});
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.connectionOk);
  await type('4');
  await waitText(T.renewLabel);
  await type(NEW_KEY);
  await type(ENTER);
  await waitText(T.renewed);
  assert.deepEqual(fake.calls.renewed, [NEW_KEY]);
});

test('si renovar la key falla se muestra el error en español y no se cambia nada', async () => {
  const { fake, type, waitText } = openHome({ renewError: 'el servidor rechazó la key' });
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.connectionOk);
  await type('4');
  await waitText(T.renewLabel);
  await type(NEW_KEY);
  await type(ENTER);
  await waitText(T.renewError('el servidor rechazó la key'));
  assert.equal(fake.calls.renewed.length, 0);
});

test('sin base, base y quitar no aplican y renovar solo vale para MCP', async () => {
  const settings = {
    ...FAKE_SETTINGS,
    type: 'none' as const,
    target: null,
    baseFolder: null,
    adrFolder: null,
    connection: 'none' as const,
  };
  const { fake, type, waitText } = openHome({ settings });
  await waitText(HOME_TEXTS.title);
  await type(KEYS.knowledgeBase);
  await waitText(T.noBase);
  await type('1');
  await waitText(T.needsBase);
  await type('4');
  await waitText(T.renewNeedsMcp);
  assert.equal(fake.calls.changed.length, 0);
});
