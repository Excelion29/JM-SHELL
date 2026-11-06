import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, type AppAction } from './app.js';
import { BASE_HEADER, createFakeChat, createFakePlan, FAKE_CODE_FOLDER, waitFor } from './test-support.js';
import { CHAT_INPUT_MAX_ROWS, CHAT_TEXTS, HOME_TEXTS, STREAM_FLUSH_MS, TAB_WIDTH } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const CTRL_O = '\u000f';
const CTRL_N = '\u000e';
const CTRL_T = '\u0014';
const NEWLINE = '\n';
const PAGE_UP = '\u001b[5~';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

// El texto de la conversación sin el marco de la app
const bodyOf = (frame: string) =>
  frame
    .split('\n')
    .map((row) => row.replace(/^│ ?/, '').replace(/ *│$/, ''))
    .join('\n');

const NO_ITEMS = async () => [];
const STORY = { key: 'AQ-45', summary: 'Login', phase: 'debate', block: 'riesgos', nextStep: 'Retoma', updatedAt: 't' };

function setup(fake = createFakeChat()) {
  const actions: AppAction[] = [];
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
      plan={createFakePlan().plan}
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
  assert.ok(frame.includes('contexto 42k') && frame.includes('$0.05'));
  assert.ok(!frame.includes('tokens'));
});

test('muestra el texto en streaming y luego el mensaje completo', async () => {
  const app = await openIdleChat();
  app.fake.emit({ type: 'textDelta', text: 'Veo que ' });
  app.fake.emit({ type: 'textDelta', text: 'hay riesgo' });
  assert.ok(!app.frame().includes('Veo que hay riesgo'));
  await new Promise((resolve) => setTimeout(resolve, STREAM_FLUSH_MS * 2));
  assert.ok(app.frame().includes('Veo que hay riesgo'));
  app.fake.emit({ type: 'assistantText', text: 'Veo que hay riesgo en pagos' });
  await tick();
  assert.ok(bodyOf(app.frame()).includes('Claude\n  Veo que hay riesgo en pagos'));
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
  assert.ok(bodyOf(app.frame()).includes('Tú\n  hola'));
});

test('una nueva línea (Ctrl+J o pegado) queda en el mismo mensaje', async () => {
  const app = await openIdleChat();
  await app.press('uno');
  await app.press(NEWLINE);
  await app.press('dos');
  await app.press(ENTER);
  assert.deepEqual(app.fake.sent, ['uno\ndos']);
});

const LINE_COUNT = 12;
const pastedBlock = () => Array.from({ length: LINE_COUNT }, (_, i) => `\tlinea ${i + 1}`).join('\n');

test('un pegado grande muestra solo las últimas filas con aviso, tabs como espacios, y envía el texto completo', async () => {
  const app = await openIdleChat();
  await app.press(pastedBlock());
  const frame = app.frame();
  const hidden = LINE_COUNT - CHAT_INPUT_MAX_ROWS;
  assert.ok(frame.includes(CHAT_TEXTS.inputClipped(hidden)));
  assert.ok(frame.includes(`${' '.repeat(TAB_WIDTH)}linea ${LINE_COUNT}`));
  assert.ok(!frame.includes('linea 1\n') && !frame.includes(' linea 1 '));
  assert.ok(!frame.includes('\t'));
  await app.press(ENTER);
  assert.deepEqual(app.fake.sent, [pastedBlock().trim()]);
  assert.ok(!app.frame().includes('\t'));
});

test('un texto corto no muestra el aviso de líneas ocultas', async () => {
  const app = await openIdleChat();
  await app.press('uno\ndos');
  assert.ok(!app.frame().includes('líneas arriba'));
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

const QUESTION_MESSAGE = 'Contexto del alcance.\n\n> **Pregunta:** ¿Qué hacemos?\n> 1. Opción A\n> 2. Opción B';
const ARROW_DOWN = '\u001b[B';
const ARROW_UP = '\u001b[A';

test('un mensaje de Claude muestra etiqueta propia, markdown sin marcas y mensajes separados', async () => {
  const history = [
    { role: 'assistant' as const, text: 'Uso **negrita** y `codigo`', at: 't' },
    { role: 'user' as const, text: 'ok', at: 't' },
  ];
  const app = await openIdleChat(createFakeChat({}, history));
  const frame = bodyOf(app.frame());
  assert.ok(frame.includes('Claude\n  Uso negrita y codigo\n\nTú\n  ok'));
  assert.ok(!frame.includes('**') && !frame.includes('`'));
});

test('la pregunta se resalta con barra y la opción se elige con el dígito si la entrada está vacía', async () => {
  const history = [{ role: 'assistant' as const, text: QUESTION_MESSAGE, at: 't' }];
  const app = await openIdleChat(createFakeChat({}, history));
  assert.ok(app.frame().includes('┃ Pregunta: ¿Qué hacemos?'));
  assert.ok(app.frame().includes('1-2 elegir'));
  await app.press('2');
  assert.deepEqual(app.fake.sent, ['2. Opción B']);
});

test('con texto en la entrada los dígitos son texto normal y no se elige', async () => {
  const history = [{ role: 'assistant' as const, text: QUESTION_MESSAGE, at: 't' }];
  const app = await openIdleChat(createFakeChat({}, history));
  await app.press('a');
  await app.press('1');
  assert.deepEqual(app.fake.sent, []);
  assert.ok(app.frame().includes('> a1'));
});

test('sin opciones no hay pista de elegir y el dígito es texto', async () => {
  const history = [{ role: 'assistant' as const, text: 'Solo contexto', at: 't' }];
  const app = await openIdleChat(createFakeChat({}, history));
  assert.ok(!app.frame().includes('elegir'));
  await app.press('1');
  assert.deepEqual(app.fake.sent, []);
  assert.ok(app.frame().includes('> 1'));
});

test('muestra la carpeta donde corre Claude bajo el encabezado', async () => {
  const app = await openIdleChat();
  assert.ok(app.frame().includes(`código: ${FAKE_CODE_FOLDER}`));
});

const longHistory = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ role: 'assistant' as const, text: `mensaje-${i}`, at: 't' }));

test('con la entrada vacía ↑ y ↓ desplazan una fila y con texto no hacen nada', async () => {
  const app = await openIdleChat(createFakeChat({}, longHistory(40)));
  await app.press(ARROW_UP);
  assert.ok(app.frame().includes(CHAT_TEXTS.scrolledHint));
  await app.press(ARROW_DOWN);
  assert.ok(!app.frame().includes(CHAT_TEXTS.scrolledHint));
  await app.press('x');
  await app.press(ARROW_UP);
  assert.ok(!app.frame().includes(CHAT_TEXTS.scrolledHint));
});

test('el historial completo es alcanzable, no solo los últimos 12 mensajes', async () => {
  const app = await openIdleChat(createFakeChat({}, longHistory(60)));
  for (let i = 0; i < 40; i += 1) await app.press(PAGE_UP);
  assert.ok(app.frame().includes('mensaje-0'));
});

test('el aviso de vuelta de Claude se muestra una vez y desaparece al pulsar una tecla', async () => {
  const notice = 'Volviste de Claude Code.';
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
      chat={createFakeChat().chat}
      plan={createFakePlan().plan}
      notice={notice}
    />,
  );
  assert.match(utils.lastFrame() ?? '', /Volviste de Claude Code\./);
  utils.stdin.write('x');
  await tick();
  assert.doesNotMatch(utils.lastFrame() ?? '', /Volviste de Claude Code\./);
});

test('una tabla Markdown en el chat se dibuja con bordes y sin barras crudas', async () => {
  const table = '| ID | Título |\n|---|---|\n| T1 | Login |\n| T2 | Pagos |';
  const history = [{ role: 'assistant' as const, text: table, at: 't' }];
  const app = await openIdleChat(createFakeChat({}, history));
  const frame = app.frame();
  assert.ok(frame.includes('┌') && frame.includes('├') && frame.includes('└'));
  assert.ok(frame.includes('│ T1 │ Login  │'));
  assert.ok(!frame.includes('|---|'));
});

test('al reabrir una historia con conversación el chat queda listo sin esperar un turno', async () => {
  const fake = createFakeChat({}, [{ role: 'assistant', text: 'Quedamos en riesgos', at: 't' }]);
  const app = setup(fake);
  await app.press(ENTER);
  await tick();
  assert.ok(bodyOf(app.frame()).includes('Quedamos en riesgos'));
  await app.press('seguimos');
  await app.press(ENTER);
  assert.deepEqual(app.fake.sent, ['seguimos']);
});
