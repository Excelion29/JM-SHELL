import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { createFakeChat, createFakePlan, FakeKnowledge, waitFor } from './test-support.js';
import { CHAT_TEXTS, HOME_TEXTS, KNOWLEDGE_TEXTS } from './texts.js';

const ENTER = '\r';
const DOWN = '[B';
const UP = '[A';
const BACKSPACE = '';
const ESC = '';
const TICK_MS = 30;
const FAKE_KEY = 'fake-key-for-tests';
const FAKE_FINGERPRINT = 'AA:BB:CC';

const NO_ITEMS = async () => [];
const baseProps = {
  plan: createFakePlan().plan,
  unlock: async () => ({ ok: true }),
  fetchEpics: NO_ITEMS,
  fetchStories: NO_ITEMS,
  fetchProjects: NO_ITEMS,
  setProject: async () => ({ ok: true }),
  loadStories: async () => [],
};

const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

const ROUTING_DELAY_MS = 150;
const STORIES = [
  { key: 'AQ-45', summary: 'Login', phase: 'debate', block: '-', nextStep: 'sigue', updatedAt: '2026-01-01' },
];

function openApp(knowledge: FakeKnowledge) {
  const fake = createFakeChat({}, [], knowledge);
  const view = render(
    <App projectKey="AQ" stories={[]} unlocked initialChatKey="AQ-45" {...baseProps} chat={fake.chat} />,
  );
  const type = async (text: string) => {
    view.stdin.write(text);
    await tick();
  };
  const frame = () => view.lastFrame() ?? '';
  const waitText = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  return { fake, type, frame, waitText };
}

const LISTINGS: FakeKnowledge['listings'] = {
  '': {
    entries: [
      { name: 'PROYECTOS', isFolder: true },
      { name: 'README.md', isFolder: false },
    ],
    adrFolder: '00-JM-ADR',
  },
  PROYECTOS: {
    entries: [
      { name: '02-Docs', isFolder: true },
      { name: 'PACASMAYO', isFolder: true },
    ],
    adrFolder: '03-JM-ADR',
  },
  'PROYECTOS/PACASMAYO': { entries: [{ name: '06-JM-ADR', isFolder: true }], adrFolder: '06-JM-ADR' },
};

test('sin decisión sobre la base: se muestra la pregunta y el chat no se abre', async () => {
  const { fake, waitText, frame } = openApp({ status: 'unset' });
  await waitText(KNOWLEDGE_TEXTS.question);
  assert.ok(frame().includes(KNOWLEDGE_TEXTS.options.local));
  assert.equal(fake.calls.opened.length, 0);
});

test('con la base ya decidida o sin poder leer su estado, va directo al chat', async () => {
  for (const knowledge of [{ status: 'set' as const }, { statusError: true }]) {
    const { fake } = openApp(knowledge);
    await waitFor(() => fake.calls.opened.length > 0);
    assert.deepEqual(fake.calls.opened, ['AQ-45']);
  }
});

test('"Ninguna" guarda none y abre el chat', async () => {
  const { fake, type, waitText } = openApp({ status: 'unset' });
  await waitText(KNOWLEDGE_TEXTS.question);
  await type(DOWN);
  await type(DOWN);
  await type(ENTER);
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.saved, [{ type: 'none' }]);
});

test('Esc en la pregunta vuelve al inicio sin guardar ni abrir el chat', async () => {
  const { fake, type, waitText } = openApp({ status: 'unset' });
  await waitText(KNOWLEDGE_TEXTS.question);
  await type(ESC);
  await waitText(HOME_TEXTS.title);
  assert.equal(fake.calls.saved.length, 0);
  assert.equal(fake.calls.opened.length, 0);
});

test('carpeta local: navega el explorador (entrar, subir, vista previa) y elige la carpeta base', async () => {
  const previews = { 'README.md': 'Convenciones de la base' };
  const { fake, type, waitText, frame } = openApp({ status: 'unset', listings: LISTINGS, previews });
  await waitText(KNOWLEDGE_TEXTS.question);
  await type(DOWN);
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.rootLabel);
  await type('C:\\notas');
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.browseTitle(''));
  await waitText('PROYECTOS/');
  assert.ok(frame().includes(KNOWLEDGE_TEXTS.adrLine('00-JM-ADR', false)));

  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.browseTitle('PROYECTOS'));
  await type(DOWN);
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.browseTitle('PROYECTOS/PACASMAYO'));
  assert.ok(frame().includes(KNOWLEDGE_TEXTS.adrLine('06-JM-ADR', true)));

  await type(BACKSPACE);
  await waitText(KNOWLEDGE_TEXTS.browseTitle('PROYECTOS'));
  await type(BACKSPACE);
  await waitText(KNOWLEDGE_TEXTS.browseTitle(''));
  await type(DOWN);
  await type(ENTER);
  await waitText('Convenciones de la base');
  await type(ESC);
  await waitText(KNOWLEDGE_TEXTS.browseTitle(''));

  await type(UP);
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.browseTitle('PROYECTOS'));
  await type('s');
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.saved, [
    { type: 'connect', baseFolder: 'PROYECTOS', connection: { type: 'local', root: 'C:\\notas' } },
  ]);
});

test('MCP con certificado propio: muestra la huella, pide confianza y guarda el certificado', async () => {
  const inspection = { tls: 'untrusted', pem: 'PEM-DE-PRUEBA', fingerprint: FAKE_FINGERPRINT } as const;
  const { fake, type, waitText, frame } = openApp({ status: 'unset', inspection, listings: LISTINGS });
  await waitText(KNOWLEDGE_TEXTS.question);
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.urlLabel);
  await type('https://127.0.0.1:27124/mcp');
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.keyLabel);
  await type(FAKE_KEY);
  assert.ok(!frame().includes(FAKE_KEY));
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.trustFingerprint(FAKE_FINGERPRINT));
  await type('s');
  await waitText(KNOWLEDGE_TEXTS.browseTitle(''));
  await waitText('PROYECTOS/');
  await type('s');
  await waitText(KNOWLEDGE_TEXTS.rootNotAllowed);
  assert.equal(fake.calls.saved.length, 0);
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.browseTitle('PROYECTOS'));
  await type('s');
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.saved, [
    {
      type: 'connect',
      baseFolder: 'PROYECTOS',
      connection: { type: 'mcp', url: 'https://127.0.0.1:27124/mcp', apiKey: FAKE_KEY, certPem: 'PEM-DE-PRUEBA' },
    },
  ]);
});

test('si no confías en el certificado se cancela sin guardar nada', async () => {
  const inspection = { tls: 'untrusted', pem: 'PEM', fingerprint: FAKE_FINGERPRINT } as const;
  const { fake, type, waitText } = openApp({ status: 'unset', inspection });
  await waitText(KNOWLEDGE_TEXTS.question);
  await type(ENTER);
  await type('https://127.0.0.1:27124/mcp');
  await type(ENTER);
  await type(FAKE_KEY);
  await type(ENTER);
  await waitText(KNOWLEDGE_TEXTS.trustQuestion);
  await type('n');
  await waitText(HOME_TEXTS.title);
  assert.equal(fake.calls.saved.length, 0);
  assert.equal(fake.calls.opened.length, 0);
});

test('una carpeta que no se puede leer muestra el error en el explorador y no guarda', async () => {
  const { fake, type, waitText, frame } = openApp({ status: 'unset', listings: {} });
  await waitText(KNOWLEDGE_TEXTS.question);
  await type(DOWN);
  await type(ENTER);
  await type('C:\\no-existe');
  await type(ENTER);
  await waitText('No pude leer la carpeta');
  assert.ok(frame().includes('no existe'));
  await type('s');
  assert.equal(fake.calls.saved.length, 0);
  assert.equal(fake.calls.opened.length, 0);
});

test('si la base no responde al abrir, el chat muestra el error y no continúa', async () => {
  const { waitText, frame } = openApp({ status: 'set', openError: 'La API key no es válida para este servidor.' });
  await waitText(CHAT_TEXTS.openError('La API key no es válida para este servidor.'));
  assert.ok(frame().includes(CHAT_TEXTS.openErrorNextStep));
});

test('base del .jira.json sin confirmar: muestra a dónde apunta y no abre el chat hasta confirmar', async () => {
  const summary = { type: 'mcp' as const, target: 'https://evil.example/mcp', baseFolder: 'PROYECTOS/X' };
  const { fake, type, waitText, frame } = openApp({ status: 'untrusted', summary });
  await waitText(KNOWLEDGE_TEXTS.confirmTitle);
  assert.ok(frame().includes('https://evil.example/mcp'));
  assert.ok(frame().includes('PROYECTOS/X'));
  assert.equal(fake.calls.opened.length, 0);
  await type('s');
  await waitFor(() => fake.calls.opened.length > 0);
  assert.equal(fake.calls.trusted, 1);
});

test('base sin confirmar: cualquier otra tecla vuelve al inicio sin confiar ni abrir el chat', async () => {
  const { fake, type, waitText } = openApp({ status: 'untrusted' });
  await waitText(KNOWLEDGE_TEXTS.confirmTitle);
  await type('n');
  await waitText(HOME_TEXTS.title);
  assert.equal(fake.calls.trusted, 0);
  assert.equal(fake.calls.opened.length, 0);
});

test('los dígitos 1-3 eligen la opción directo y la pista los menciona', async () => {
  const { fake, type, waitText, frame } = openApp({ status: 'unset' });
  await waitText(KNOWLEDGE_TEXTS.question);
  assert.ok(frame().includes(KNOWLEDGE_TEXTS.kindKeysHint));
  await type('3');
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.saved, [{ type: 'none' }]);
  const second = openApp({ status: 'unset' });
  await second.waitText(KNOWLEDGE_TEXTS.question);
  await second.type('2');
  await second.waitText(KNOWLEDGE_TEXTS.rootLabel);
});

test('pasar por "routing" no apaga el modo raw: las flechas y el chat siguen respondiendo', async () => {
  const fake = createFakeChat({}, [], { status: 'unset', statusDelayMs: ROUTING_DELAY_MS });
  const view = render(<App projectKey="AQ" stories={STORIES} unlocked {...baseProps} chat={fake.chat} />);
  const rawCalls: boolean[] = [];
  (view.stdin as unknown as { setRawMode: (enabled: boolean) => void }).setRawMode = (enabled) =>
    void rawCalls.push(enabled);
  const frame = () => view.lastFrame() ?? '';
  const press = async (text: string) => {
    view.stdin.write(text);
    await tick();
  };
  await press(ENTER);
  await waitFor(() => frame().includes(KNOWLEDGE_TEXTS.routing), 'el texto de preparación');
  await waitFor(() => frame().includes(KNOWLEDGE_TEXTS.question), 'la pregunta de la base');
  await press(DOWN);
  assert.ok(frame().includes(`${HOME_TEXTS.selectedMarker} ${KNOWLEDGE_TEXTS.options.local}`));
  await press(DOWN);
  await press(ENTER);
  await waitFor(() => fake.calls.opened.length > 0);
  await waitFor(() => !frame().includes(CHAT_TEXTS.preparing), 'el chat abierto');
  await press('hola');
  assert.ok(frame().includes('hola'));
  assert.ok(!rawCalls.includes(false), 'setRawMode(false) no debe llamarse durante la transición');
});
