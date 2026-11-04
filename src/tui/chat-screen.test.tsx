import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import { BASE_HEADER, createFakeChat, FakeChatOptions, waitFor } from './test-support.js';
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

// El texto de la conversación sin el marco de la app
const bodyOf = (frame: string) =>
  frame
    .split('\n')
    .map((row) => row.replace(/^│ ?/, '').replace(/ *│$/, ''))
    .join('\n');

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
const CTRL_F = '';
const PROMPT_TITLE = '¿Dónde está el código de AQ?';
const folderSetup = (options: FakeChatOptions = { needsFolder: true }) => setup(createFakeChat({}, [], options));
const prompt = async (app: ReturnType<typeof setup>) => {
  await app.press(ENTER);
  await waitFor(() => app.frame().includes(PROMPT_TITLE), 'el prompt de carpeta');
};

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

test('sin carpeta de código: pregunta dónde está y no abre la conversación hasta resolverlo', async () => {
  const app = folderSetup();
  await prompt(app);
  assert.deepEqual(app.fake.calls.opened, []);
});

test('guardar una ruta válida abre la conversación', async () => {
  const app = folderSetup();
  await prompt(app);
  await app.press('C:\\codigo\\aq');
  await app.press(ENTER);
  await waitFor(() => app.fake.calls.opened.length > 0, 'que abra el chat');
  assert.deepEqual(app.fake.calls.saved, [{ projectKey: 'AQ', folder: 'C:\\codigo\\aq' }]);
  assert.deepEqual(app.fake.calls.opened, ['AQ-45']);
});

test('una ruta inválida muestra el error y sigue pidiendo la carpeta', async () => {
  const app = folderSetup({ needsFolder: true, saveError: 'No encontré la carpeta' });
  await prompt(app);
  await app.press('x');
  await app.press(ENTER);
  await waitFor(() => app.frame().includes('No encontré la carpeta'));
  assert.deepEqual(app.fake.calls.opened, []);
});

test('Refinar sin código abre la conversación y avisa al puente', async () => {
  const app = folderSetup();
  await prompt(app);
  await app.press(ARROW_DOWN);
  await app.press(ENTER);
  await waitFor(() => app.fake.calls.opened.length > 0, 'que abra el chat');
  assert.deepEqual(app.fake.calls.skipped, ['AQ']);
  assert.deepEqual(app.fake.calls.opened, ['AQ-45']);
});

test('Esc en la pregunta de carpeta vuelve al inicio sin abrir nada', async () => {
  const app = folderSetup();
  await prompt(app);
  await app.press(ESC);
  await waitFor(() => app.frame().includes(HOME_TEXTS.title));
  assert.deepEqual(app.fake.calls.opened, []);
});

test('con el directorio actual del mismo proyecto el prompt viene prellenado y Enter lo confirma', async () => {
  const app = folderSetup({ needsFolder: true, suggestedFolder: 'C:\repo\jm' });
  await prompt(app);
  assert.ok(app.frame().includes('¿El código de AQ está en esta carpeta? Enter para confirmar o escribe otra ruta.'));
  assert.ok(app.frame().includes('Ruta: C:\repo\jm'));
  await app.press(ENTER);
  await waitFor(() => app.fake.calls.opened.length > 0, 'que abra el chat');
  assert.deepEqual(app.fake.calls.saved, [{ projectKey: 'AQ', folder: 'C:\repo\jm' }]);
});

test('escribir sobre la ruta sugerida la reemplaza', async () => {
  const app = folderSetup({ needsFolder: true, suggestedFolder: 'C:\repo\jm' });
  await prompt(app);
  await app.press('D:\otro');
  await app.press(ENTER);
  await waitFor(() => app.fake.calls.saved.length > 0, 'que guarde');
  assert.deepEqual(app.fake.calls.saved, [{ projectKey: 'AQ', folder: 'D:\otro' }]);
});

test('sin sugerencia el prompt empieza vacío y no avisa nunca de un mapeo silencioso', async () => {
  const app = folderSetup();
  await prompt(app);
  assert.ok(app.frame().includes('Ruta: ▌'));
  assert.ok(!app.frame().includes('en esta carpeta'));
});

test('con mapeo muestra "código: <ruta>" tenue y Ctrl+F con la entrada vacía reabre el prompt para cambiarlo', async () => {
  const fake = createFakeChat({}, [], { codeFolder: 'C:\repo\viejo' });
  const app = await openIdleChat(fake);
  assert.ok(app.frame().includes('código: C:\repo\viejo'));
  await app.press('x');
  await app.press(CTRL_F);
  assert.deepEqual(fake.calls.checks, [false]);
  await app.press('');
  await app.press(CTRL_F);
  await waitFor(() => app.frame().includes(PROMPT_TITLE), 'el prompt de carpeta');
  assert.deepEqual(fake.calls.checks, [false, true]);
  assert.ok(app.frame().includes('Ruta: C:\repo\viejo'));
  await app.press('D:/repo/nuevo');
  await app.press(ENTER);
  await waitFor(() => fake.calls.opened.length === 2, 'que reabra el chat');
  assert.deepEqual(fake.calls.saved, [{ projectKey: 'AQ', folder: 'D:/repo/nuevo' }]);
  await waitFor(() => app.frame().includes('código: D:/repo/nuevo'));
});

test('una historia sin código lo indica tenue bajo el encabezado', async () => {
  const app = await openIdleChat();
  assert.ok(app.frame().includes('historia sin código'));
});
