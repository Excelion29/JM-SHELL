import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, type AppAction } from './app.js';
import type { StorySummary } from '../refinement/types.js';
import {
  BASE_HEADER,
  createFakeAnalysis,
  createFakeChat,
  createFakePlan,
  type FakeKnowledge,
  waitFor,
} from './test-support.js';
import { CHAT_KEYS, CHAT_TEXTS, KNOWLEDGE_TEXTS } from './texts.js';
import type { ChatHeader } from '../refinement/chat-types.js';

const ENTER = '\r';
const ESC = '\u001b';
const CTRL_T = '\u0014';
const CTRL_G = '\u0007';
const CTRL_B = '\u0002';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const NO_ITEMS = async () => [];
const NOTE = 'nota.md';
const BASE = 'PROYECTOS/X';
const NOTE_PATH = `${BASE}/${NOTE}`;
const LISTINGS: FakeKnowledge['listings'] = {
  [BASE]: {
    entries: [
      { name: 'carpeta', isFolder: true },
      { name: NOTE, isFolder: false },
    ],
    adrFolder: '06-JM-ADR',
  },
  [`${BASE}/carpeta`]: { entries: [{ name: 'otra.md', isFolder: false }], adrFolder: '06-JM-ADR' },
};
const ANALYSIS_HEADER: Partial<ChatHeader> = {
  kind: 'analysis',
  phase: 'debate',
  phaseLabel: 'debate',
  blockLabel: 'puntos',
  detail: '2 puntos · 3h esperadas',
};
const ANALYSIS_ROW: StorySummary = {
  key: 'an-1',
  kind: 'analysis',
  summary: 'Observaciones',
  phase: 'fuentes',
  block: '—',
  nextStep: 'Pulsa Enter para continuar el análisis.',
  updatedAt: 't',
};
const STORY_ROW: StorySummary = {
  key: 'AQ-45',
  summary: 'Login',
  phase: 'debate',
  block: 'riesgos',
  nextStep: 'Retoma',
  updatedAt: 't',
};

async function openChat(row: StorySummary, header: Partial<ChatHeader>, knowledge: FakeKnowledge = {}) {
  const fake = createFakeChat(header, [], { listings: LISTINGS, ...knowledge });
  const actions: AppAction[] = [];
  const utils = render(
    <App
      projectKey="AQ"
      stories={[row]}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={NO_ITEMS}
      fetchStories={NO_ITEMS}
      fetchProjects={NO_ITEMS}
      setProject={async () => ({ ok: true })}
      loadStories={async () => [row]}
      chat={fake.chat}
      plan={createFakePlan().plan}
      analysis={createFakeAnalysis().analysis}
      onAction={(a) => actions.push(a)}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  await press(ENTER);
  await waitFor(() => fake.calls.opened.length > 0, 'que abra el chat');
  // Deja pasar el primer turno para poder escribir
  fake.emit({ type: 'turnEnd', header: { ...BASE_HEADER, ...header } });
  await tick();
  return { fake, actions, frame, press, has };
}

test('Enter en un análisis abre el chat con su encabezado: fase, bloque y puntos', async () => {
  const app = await openChat(ANALYSIS_ROW, ANALYSIS_HEADER);
  assert.deepEqual(app.fake.calls.opened, ['an-1']);
  await app.has('2 puntos · 3h esperadas');
  assert.ok(app.frame().includes('puntos'));
});

test('el atajo de cierre envía el mensaje fijo que pide los 3 documentos, solo en un análisis', async () => {
  const analysis = await openChat(ANALYSIS_ROW, ANALYSIS_HEADER);
  await analysis.press(CTRL_G);
  await waitFor(() => analysis.fake.sent.length > 0, 'el mensaje de cierre');
  assert.deepEqual(analysis.fake.sent, [CHAT_TEXTS.closeAnalysisMessage]);
  assert.match(CHAT_TEXTS.closeAnalysisMessage, /análisis_propuesta\.md.*resumen_observaciones\.md/);
  assert.ok(analysis.frame().includes('Ctrl+' + CHAT_KEYS.closeAnalysis.toUpperCase()));

  const story = await openChat(STORY_ROW, {});
  await story.press(CTRL_G);
  assert.deepEqual(story.fake.sent, [], 'en una historia el atajo no hace nada');
});

test('Ctrl+T (Claude completo) está desactivado en un análisis y sigue activo en una historia', async () => {
  const analysis = await openChat(ANALYSIS_ROW, ANALYSIS_HEADER);
  await analysis.press(CTRL_T);
  assert.deepEqual(analysis.actions, []);
  assert.ok(!analysis.frame().includes('Claude completo'));
  const story = await openChat(STORY_ROW, {});
  await story.press(CTRL_T);
  await waitFor(() => story.actions.length > 0, 'el pedido de Claude completo');
  assert.deepEqual(story.actions, [{ type: 'handoff', key: 'AQ-45' }]);
});

for (const [name, row, header] of [
  ['historia', STORY_ROW, {}],
  ['análisis', ANALYSIS_ROW, ANALYSIS_HEADER],
] as const) {
  test(`notas de la base en una ${name}: se marcan, se confirman y quedan referenciadas`, async () => {
    const app = await openChat(row, header);
    await app.press(CTRL_B);
    await app.has(KNOWLEDGE_TEXTS.notesTitle(BASE));
    // La carpeta va primero: se baja a la nota y se marca
    await app.press('\u001b[B');
    await app.press(' ');
    await app.has(`${KNOWLEDGE_TEXTS.notesMarker(true)} ${NOTE}`);
    await app.has(KNOWLEDGE_TEXTS.notesCount(1));
    await app.press('s');
    await app.has(CHAT_TEXTS.notesSent(1));
    await waitFor(() => app.fake.calls.notes.length > 0, 'las notas referenciadas');
    assert.deepEqual(app.fake.calls.notes, [[NOTE_PATH]]);
    assert.deepEqual(app.fake.calls.listed.at(0)?.connection, { type: 'current' });
  });
}

test('confirmar sin marcar avisa, Esc cancela sin referenciar y se puede entrar a carpetas', async () => {
  const app = await openChat(ANALYSIS_ROW, ANALYSIS_HEADER);
  await app.press(CTRL_B);
  await app.has(KNOWLEDGE_TEXTS.notesTitle(BASE));
  await app.press('s');
  await app.has(KNOWLEDGE_TEXTS.notesNoneMarked);
  await app.press(ENTER);
  await app.has(KNOWLEDGE_TEXTS.notesTitle(`${BASE}/carpeta`));
  await app.press(ESC);
  await app.has(CHAT_TEXTS.inputPrompt);
  assert.deepEqual(app.fake.calls.notes, []);
  assert.ok(!app.frame().includes(KNOWLEDGE_TEXTS.notesTitle(BASE)));
});

test('sin base de conocimiento el atajo de notas avisa y no abre el navegador', async () => {
  const app = await openChat(ANALYSIS_ROW, ANALYSIS_HEADER, {
    settings: {
      type: 'none',
      target: null,
      baseFolder: null,
      adrFolder: null,
      connection: 'none',
      connectionError: null,
    },
  });
  await app.press(CTRL_B);
  await app.has(CHAT_TEXTS.notesNoKnowledge);
  assert.ok(!app.frame().includes(KNOWLEDGE_TEXTS.notesTitle(BASE)));
});

test('si las notas ya estaban referenciadas lo avisa y no pide nada a Claude', async () => {
  const app = await openChat(STORY_ROW, {}, { notesAdded: 0 });
  await app.press(CTRL_B);
  await app.press('\u001b[B');
  await app.press(' ');
  await app.press('s');
  await app.has(CHAT_TEXTS.notesAlready);
  assert.deepEqual(app.fake.sent, []);
});

test('Ctrl+G con Claude trabajando avisa que espere y no envía el cierre', async () => {
  const app = await openChat(ANALYSIS_ROW, ANALYSIS_HEADER);
  await app.press('hola');
  await app.press(ENTER);
  await waitFor(() => app.fake.sent.length === 1, 'el mensaje del dev');
  await app.press(CTRL_G);
  await app.has(CHAT_TEXTS.closeBusy);
  assert.deepEqual(app.fake.sent, ['hola']);
});
