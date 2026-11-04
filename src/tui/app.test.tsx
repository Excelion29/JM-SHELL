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
  const { stdin, lastFrame } = render(<App projectKey="AQ" unlock={async () => ({ ok: true })} />);
  await typePin(stdin, VALID_PIN);
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes(HOME_TEXTS.title));
  assert.ok(frame.includes('AQ'));
});

test('muestra el error y permite reintentar cuando el PIN es incorrecto', async () => {
  const message = 'PIN incorrecto';
  const { stdin, lastFrame } = render(<App projectKey="AQ" unlock={async () => ({ ok: false, message })} />);
  await typePin(stdin, VALID_PIN);
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes(message));
  assert.ok(!frame.includes(HOME_TEXTS.title));
});
