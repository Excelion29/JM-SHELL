import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { BASE_HEADER, createFakeChat } from './test-support.js';
import { CHAT_TEXTS, HOME_TEXTS, STREAM_FLUSH_MS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const CTRL_O = '\u000f';
const CTRL_N = '\u000e';
const CTRL_T = '\u0014';
const NEWLINE = '\n';
const PAGE_UP = '\u001b[5~';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

const NO_ITEMS = async () => [];
const STORY = { key: 'AQ-45', summary: 'Login', phase: 'debate', block: 'riesgos', nextStep: 'Retoma', updatedAt: 't' };

function setup(fake = createFakeChat()) {
  const actions: Array<{ type: string; key: string }> = [];
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
      chat={fake.chat}
      onAction={(a) => actions.push(a)}
    />,
  );
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  return { ...utils, press, fake, actions, frame: () => utils.lastFrame() ?? '' };
}

// Abre el chat y deja pasar el primer turno (el resumen de retoma) para poder escribir
async function openIdleChat(fake = createFakeChat()) {
  const app = setup(fake);
  await app.press(ENTER);
  await tick();
  app.fake.emit({ type: 'turnEnd', header: { ...BASE_HEADER, ...fake.header } });
  await tick();
  return app;
}

test('Enter en una historia abre el chat con el encabezado de la historia', async () => {
  const app = setup();
  await app.press(ENTER);
  await tick();
  assert.deepEqual(app.fake.calls.opened, ['AQ-45']);
  const frame = app.frame();
  assert.ok(frame.includes('AQ-45') && frame.includes('riesgos') && frame.includes('Sonnet'));
  assert.ok(frame.includes(CHAT_TEXTS.tokens(1200)) && frame.includes('$0.05'));
});

test('muestra el texto en streaming y luego el mensaje completo', async () => {
  const app = await openIdleChat();
  app.fake.emit({ type: 'textDelta', text: 'Veo que ' });
  app.fake.emit({ type: 'textDelta', text: 'hay riesgo' });
  assert.ok(!app.frame().includes('Veo que hay riesgo'));
  await new Promise((resolve) => setTimeout(resolve, STREAM_FLUSH_MS * 2));
  assert.ok(app.frame().includes('Claude: Veo que hay riesgo'));
  app.fake.emit({ type: 'assistantText', text: 'Veo que hay riesgo en pagos' });
  await tick();
  assert.ok(app.frame().includes('Claude: Veo que hay riesgo en pagos'));
});

test('muestra la actividad tenue mientras trabaja', async () => {
  const app = await openIdleChat();
  await app.press('hola');
  await app.press(ENTER);
  app.fake.emit({ type: 'activity', tool: 'Read', target: 'src/a.ts' });
  await tick();
  assert.ok(app.frame().includes(CHAT_TEXTS.activity.read('src/a.ts')));
  app.fake.emit({ type: 'activity', tool: 'Agent', target: 'explorador' });
  await tick();
  assert.ok(app.frame().includes(CHAT_TEXTS.activity.explore));
});

test('escribe, envía con Enter y no envía vacío', async () => {
  const app = await openIdleChat();
  await app.press(ENTER);
  assert.deepEqual(app.fake.sent, []);
  await app.press('hola');
  await app.press(ENTER);
  assert.deepEqual(app.fake.sent, ['hola']);
  assert.ok(app.frame().includes('Tú: hola'));
});

test('una nueva línea (Ctrl+J o pegado) queda en el mismo mensaje', async () => {
  const app = await openIdleChat();
  await app.press('uno');
  await app.press(NEWLINE);
  await app.press('dos');
  await app.press(ENTER);
  assert.deepEqual(app.fake.sent, ['uno\ndos']);
});

test('Ctrl+O alterna Opus y la letra o escrita es texto del mensaje', async () => {
  const app = await openIdleChat();
  await app.press('o');
  assert.equal(app.fake.calls.toggle, 0);
  assert.ok(app.frame().includes('> o'));
  await app.press(CTRL_O);
  assert.equal(app.fake.calls.toggle, 1);
});

test('Esc vuelve al inicio y cierra la conversación', async () => {
  const app = await openIdleChat();
  await app.press(ESC);
  await tick();
  assert.ok(app.frame().includes(HOME_TEXTS.title));
  assert.equal(app.fake.calls.close, 1);
});

test('Ctrl+T pide abrir Claude completo con la clave de la historia', async () => {
  const app = await openIdleChat();
  await app.press(CTRL_T);
  assert.deepEqual(app.actions, [{ type: 'handoff', key: 'AQ-45' }]);
});

test('con fase plan aparece el aviso de plan listo', async () => {
  const app = await openIdleChat(createFakeChat({ phase: 'plan', phaseLabel: 'plan' }));
  assert.ok(app.frame().includes(CHAT_TEXTS.planReady));
});

test('con la conversación larga muestra el aviso y Ctrl+N abre una sesión nueva', async () => {
  const fake = createFakeChat({ tooLong: true });
  const app = await openIdleChat(fake);
  assert.ok(app.frame().includes('La conversación ya es larga'));
  await app.press(CTRL_N);
  assert.equal(fake.calls.newSession, 1);
});

test('sin conversación larga Ctrl+N no hace nada', async () => {
  const app = await openIdleChat();
  await app.press(CTRL_N);
  assert.equal(app.fake.calls.newSession, 0);
});

test('muestra el historial al reabrir y PgUp desplaza hacia atrás', async () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: 'assistant' as const, text: `mensaje-${i}`, at: 't' }));
  const app = await openIdleChat(createFakeChat({}, history));
  assert.ok(app.frame().includes('mensaje-39'));
  assert.ok(!app.frame().includes('mensaje-0 '));
  await app.press(PAGE_UP);
  assert.ok(!app.frame().includes('mensaje-39'));
  assert.ok(app.frame().includes(CHAT_TEXTS.scrolledHint));
});

test('un error al abrir se muestra con el siguiente paso', async () => {
  const fake = createFakeChat();
  fake.chat.open = async () => {
    throw new Error('sin claude');
  };
  const app = setup(fake);
  await app.press(ENTER);
  await tick();
  assert.ok(app.frame().includes(CHAT_TEXTS.openError('sin claude')));
  assert.ok(app.frame().includes(CHAT_TEXTS.openErrorNextStep));
});
