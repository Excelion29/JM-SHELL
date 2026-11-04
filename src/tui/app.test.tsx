import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { HOME_TEXTS } from './texts.js';

const ENTER = '\r';
const VALID_PIN = '1234';
const TICK_MS = 50;

const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

async function typePin(stdin: { write: (data: string) => void }, pin: string) {
  stdin.write(pin);
  await tick();
  stdin.write(ENTER);
  await tick();
}

test('muestra el inicio cuando el PIN es correcto', async () => {
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} unlock={async () => ({ ok: true })} />);
  await typePin(stdin, VALID_PIN);
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes(HOME_TEXTS.title));
  assert.ok(frame.includes('AQ'));
});

const STORIES = [
  { key: 'AQ-45', summary: 'Login social', phase: 'debate', block: 'riesgos', nextStep: 'Retoma el debate', updatedAt: '2026-11-04T10:00:00.000Z' },
  { key: 'AQ-46', summary: 'Reporte mensual', phase: 'plan', block: '—', nextStep: 'Revisa el plan', updatedAt: '2026-11-03T10:00:00.000Z' },
];
const DOWN = '[B';

test('lista las historias y Enter devuelve la acción de refinar', async () => {
  const actions: Array<{ type: string; key: string }> = [];
  const { stdin, lastFrame } = render(
    <App projectKey="AQ" stories={STORIES} unlocked unlock={async () => ({ ok: true })} onAction={(a) => actions.push(a)} />,
  );
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes('AQ-45') && frame.includes('AQ-46') && frame.includes('riesgos'));
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await tick();
  assert.deepEqual(actions, [{ type: 'refine', key: 'AQ-46' }]);
});

test('n abre la entrada de clave y rechaza una inválida', async () => {
  const actions: Array<{ type: string; key: string }> = [];
  const { stdin, lastFrame } = render(
    <App projectKey="AQ" stories={[]} unlocked unlock={async () => ({ ok: true })} onAction={(a) => actions.push(a)} />,
  );
  assert.ok((lastFrame() ?? '').includes(HOME_TEXTS.empty));
  stdin.write('n');
  await tick();
  stdin.write('abc');
  await tick();
  stdin.write(ENTER);
  await tick();
  assert.ok((lastFrame() ?? '').includes(HOME_TEXTS.invalidKey));
  assert.equal(actions.length, 0);
});

test('n abre la entrada de clave y acepta una válida en minúsculas', async () => {
  const actions: Array<{ type: string; key: string }> = [];
  const { stdin } = render(
    <App projectKey="AQ" stories={[]} unlocked unlock={async () => ({ ok: true })} onAction={(a) => actions.push(a)} />,
  );
  stdin.write('n');
  await tick();
  stdin.write('aq-9');
  await tick();
  stdin.write(ENTER);
  await tick();
  assert.deepEqual(actions, [{ type: 'refine', key: 'AQ-9' }]);
});

test('muestra el error y permite reintentar cuando el PIN es incorrecto', async () => {
  const message = 'PIN incorrecto';
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} unlock={async () => ({ ok: false, message })} />);
  await typePin(stdin, VALID_PIN);
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes(message));
  assert.ok(!frame.includes(HOME_TEXTS.title));
});
