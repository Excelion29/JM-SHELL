import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { createFakeChat, createFakePlan, waitFor } from './test-support.js';
import { HOME_TEXTS, MANUAL_KEY_TEXTS } from './texts.js';

const ENTER = '\r';
const VALID_PIN = '1234';
const TICK_MS = 30;

const NO_ITEMS = async () => [];
const noopProps = {
  chat: createFakeChat().chat,
  plan: createFakePlan().plan,
  unlock: async () => ({ ok: true }),
  fetchEpics: NO_ITEMS,
  fetchStories: NO_ITEMS,
  fetchProjects: NO_ITEMS,
  setProject: async () => ({ ok: true }),
  loadStories: async () => [],
};

const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

async function typePin(stdin: { write: (data: string) => void }, pin: string) {
  stdin.write(pin);
  await tick();
  stdin.write(ENTER);
  await tick();
}

test('muestra el inicio cuando el PIN es correcto', async () => {
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} {...noopProps} />);
  await typePin(stdin, VALID_PIN);
  await waitFor(() => (lastFrame() ?? '').includes(HOME_TEXTS.title));
  assert.ok((lastFrame() ?? '').includes('AQ'));
});

test('al ingresar el PIN recarga las historias (las de la base solo se leen con PIN)', async () => {
  const vaultStory = {
    key: 'PM-136',
    summary: 'Lista de insumos',
    phase: 'plan',
    block: '—',
    nextStep: 'Revisa el plan',
    updatedAt: '2026-11-05T10:00:00.000Z',
  };
  const { stdin, lastFrame } = render(
    <App projectKey="PM" stories={[]} {...noopProps} loadStories={async () => [vaultStory]} />,
  );
  await typePin(stdin, VALID_PIN);
  await waitFor(() => (lastFrame() ?? '').includes('PM-136'));
});

const STORIES = [
  {
    key: 'AQ-45',
    summary: 'Login social',
    phase: 'debate',
    block: 'riesgos',
    nextStep: 'Retoma el debate',
    updatedAt: '2026-11-04T10:00:00.000Z',
  },
  {
    key: 'AQ-46',
    summary: 'Reporte mensual',
    phase: 'plan',
    block: '—',
    nextStep: 'Revisa el plan',
    updatedAt: '2026-11-03T10:00:00.000Z',
  },
];
const DOWN = '[B';

test('lista las historias y Enter abre el chat de la historia elegida', async () => {
  const fake = createFakeChat();
  const { stdin, lastFrame } = render(
    <App projectKey="AQ" stories={STORIES} unlocked {...noopProps} chat={fake.chat} />,
  );
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes('AQ-45') && frame.includes('AQ-46') && frame.includes('riesgos'));
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.opened, ['AQ-46']);
});

test('n y luego / abre la entrada de clave y rechaza una inválida', async () => {
  const fake = createFakeChat();
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} unlocked {...noopProps} chat={fake.chat} />);
  assert.ok((lastFrame() ?? '').includes(HOME_TEXTS.empty));
  stdin.write('n');
  await tick();
  stdin.write('/');
  await waitFor(() => (lastFrame() ?? '').includes(MANUAL_KEY_TEXTS.title));
  stdin.write('abc');
  await tick();
  stdin.write(ENTER);
  await waitFor(() => (lastFrame() ?? '').includes(MANUAL_KEY_TEXTS.invalidKey));
  assert.equal(fake.calls.opened.length, 0);
});

test('n y luego k abre la entrada de clave y acepta una válida en minúsculas', async () => {
  const fake = createFakeChat();
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} unlocked {...noopProps} chat={fake.chat} />);
  stdin.write('n');
  await tick();
  stdin.write('k');
  await waitFor(() => (lastFrame() ?? '').includes(MANUAL_KEY_TEXTS.title));
  stdin.write('aq-9');
  await tick();
  stdin.write(ENTER);
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.opened, ['AQ-9']);
});

test('muestra el error y permite reintentar cuando el PIN es incorrecto', async () => {
  const message = 'PIN incorrecto';
  const { stdin, lastFrame } = render(
    <App projectKey="AQ" stories={[]} {...noopProps} unlock={async () => ({ ok: false, message })} />,
  );
  await typePin(stdin, VALID_PIN);
  await waitFor(() => (lastFrame() ?? '').includes(message));
  assert.ok(!(lastFrame() ?? '').includes(HOME_TEXTS.title));
});
