import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, AppAction } from './app.js';
import { createFakeChat } from './test-support.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, HOME_TEXTS, PROJECT_TEXTS } from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const DOWN = '\u001b[B';
const TICK_MS = 80;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

const EPICS = [
  { key: 'AQ-1', summary: 'Pagos', status: 'En curso' },
  { key: 'AQ-2', summary: 'Reportes', status: 'Por hacer' },
];
const STORIES_BY_EPIC: Record<string, Array<{ key: string; summary: string; status: string }>> = {
  'AQ-1': [{ key: 'AQ-10', summary: 'Cobro con tarjeta', status: 'Por hacer' }],
  none: [{ key: 'AQ-20', summary: 'Historia suelta', status: 'Por hacer' }],
};
const PROJECTS = [
  { key: 'AQ', name: 'Aquarius' },
  { key: 'ZX', name: 'Zeta' },
];
const LOCAL = [
  {
    key: 'AQ-10',
    summary: 'Cobro con tarjeta',
    phase: 'debate',
    block: 'riesgos',
    nextStep: 'Retoma',
    updatedAt: '2026-11-04T10:00:00.000Z',
  },
];

const LOCAL_BY_PROJECT: Record<string, typeof LOCAL> = {
  AQ: LOCAL,
  ZX: [{ ...LOCAL[0], key: 'ZX-5', summary: 'Historia de Zeta' }],
};

function setup(overrides: Partial<React.ComponentProps<typeof App>> = {}) {
  const actions: AppAction[] = [];
  const fake = createFakeChat();
  const calls = { stories: [] as Array<string | null>, projects: [] as string[] };
  const utils = render(
    <App
      projectKey="AQ"
      stories={LOCAL}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={async () => EPICS}
      fetchStories={async (epic) => (calls.stories.push(epic), STORIES_BY_EPIC[epic ?? 'none'])}
      fetchProjects={async () => PROJECTS}
      loadStories={async (key) => LOCAL_BY_PROJECT[key ?? ''] ?? []}
      setProject={async (key) => (calls.projects.push(key), { ok: true })}
      chat={fake.chat}
      onAction={(a) => actions.push(a)}
      {...overrides}
    />,
  );
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  return { ...utils, press, actions, calls, fake, frame: () => utils.lastFrame() ?? '' };
}

test('n lista las épicas y Enter en una épica muestra sus historias con el marcador local', async () => {
  const app = setup();
  await app.press('n');
  assert.ok(app.frame().includes(BROWSE_TEXTS.noEpicLabel));
  assert.ok(app.frame().includes('AQ-1 Pagos') && app.frame().includes('En curso'));
  await app.press(DOWN);
  await app.press(ENTER);
  assert.deepEqual(app.calls.stories, ['AQ-1']);
  assert.ok(app.frame().includes('AQ-10 Cobro con tarjeta'));
  assert.ok(app.frame().includes(BROWSE_TEXTS.localMarker('debate')));
});

test('elegir una historia abre el chat dentro de la app', async () => {
  const app = setup();
  await app.press('n');
  await app.press(DOWN);
  await app.press(ENTER);
  await app.press(ENTER);
  assert.deepEqual(app.fake.calls.opened, ['AQ-10']);
  assert.deepEqual(app.actions, []);
});

test('la fila "sin épica" pide historias con epicKey null', async () => {
  const app = setup();
  await app.press('n');
  await app.press(ENTER);
  assert.deepEqual(app.calls.stories, [null]);
  assert.ok(app.frame().includes('AQ-20'));
});

test('Esc retrocede un nivel y desde las épicas vuelve al inicio', async () => {
  const app = setup();
  await app.press('n');
  await app.press(DOWN);
  await app.press(ENTER);
  assert.ok(app.frame().includes(BROWSE_TEXTS.storiesTitle('AQ-1')));
  await app.press(ESC);
  assert.ok(app.frame().includes(BROWSE_TEXTS.epicsTitle));
  await app.press(ESC);
  assert.ok(app.frame().includes(HOME_TEXTS.title));
});

test('escribir filtra la lista', async () => {
  const app = setup();
  await app.press('n');
  await app.press('rep');
  assert.ok(app.frame().includes('AQ-2 Reportes'));
  assert.ok(!app.frame().includes('AQ-1 Pagos'));
});

test('p lista los proyectos y elegir otro, tras confirmar, llama a setProject y actualiza el encabezado', async () => {
  const app = setup();
  await app.press('p');
  assert.ok(app.frame().includes('Aquarius') && app.frame().includes('Zeta'));
  await app.press(DOWN);
  await app.press(ENTER);
  assert.ok(app.frame().includes(PROJECT_TEXTS.confirm('AQ', 'ZX')));
  await app.press('s');
  assert.deepEqual(app.calls.projects, ['ZX']);
  assert.ok(app.frame().includes('ZX'));
  assert.ok(app.frame().includes(HOME_TEXTS.title));
});

test('responder n al confirmar no cambia el proyecto', async () => {
  const app = setup();
  await app.press('p');
  await app.press(DOWN);
  await app.press(ENTER);
  await app.press('n');
  assert.deepEqual(app.calls.projects, []);
});

test('p también funciona dentro del selector', async () => {
  const app = setup();
  await app.press('n');
  await app.press('p');
  assert.ok(app.frame().includes(PROJECT_TEXTS.title));
});

test('un error al traer épicas se muestra y la app sigue viva con reintento', async () => {
  let attempts = 0;
  const app = setup({
    fetchEpics: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Jira no responde');
      return EPICS;
    },
  });
  await app.press('n');
  assert.ok(app.frame().includes(BROWSE_TEXTS.loadError('Jira no responde')));
  assert.ok(app.frame().includes(BROWSE_TEXTS.loadErrorNextStep));
  await app.press('r');
  assert.ok(app.frame().includes('AQ-1 Pagos'));
});

test('si setProject falla se muestra el mensaje y no se cambia el encabezado', async () => {
  const app = setup({ setProject: async () => ({ ok: false, message: 'sin permisos' }) });
  await app.press('p');
  await app.press(DOWN);
  await app.press(ENTER);
  await app.press('s');
  assert.ok(app.frame().includes(PROJECT_TEXTS.saveError('sin permisos')));
  assert.ok(!app.frame().includes('ZX\n'));
});

test('al cambiar de proyecto el inicio recarga las historias locales de ese proyecto', async () => {
  const app = setup();
  assert.ok(app.frame().includes('AQ-10'));
  await app.press('p');
  await app.press(DOWN);
  await app.press(ENTER);
  await app.press('s');
  assert.ok(app.frame().includes('ZX-5'));
  assert.ok(!app.frame().includes('AQ-10'));
});

test('con 100 resultados avisa que se muestran los primeros', async () => {
  const many = Array.from({ length: BROWSE_LIMIT }, (_, i) => ({ key: `AQ-${i + 100}`, summary: `Épica ${i}`, status: 'Por hacer' }));
  const app = setup({ fetchEpics: async () => many });
  await app.press('n');
  assert.ok(app.frame().includes(BROWSE_TEXTS.limitNote));
});

test('con menos del límite no muestra el aviso', async () => {
  const app = setup();
  await app.press('n');
  assert.ok(!app.frame().includes(BROWSE_TEXTS.limitNote));
});
