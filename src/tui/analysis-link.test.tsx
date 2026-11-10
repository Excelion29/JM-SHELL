import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import type { StorySummary } from '../refinement/types.js';
import {
  createFakeAnalysis,
  createFakeChat,
  createFakePlan,
  createFakeTasks,
  type FakeAnalysisOptions,
  fakePointRow,
  waitFor,
} from './test-support.js';
import { HOME_TEXTS, LINK_TEXTS as T, POINTS_TEXTS } from './texts.js';

const ESC = '\u001b';
const ENTER = '\r';
const DOWN = '\u001b[B';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const ANALYSIS_ID = 'an-1';
const EPIC = 'AQ-5';
const STORY_A = 'AQ-20';
const STORY_B = 'AQ-21';

const ANALYSIS_ROW: StorySummary = {
  key: ANALYSIS_ID,
  kind: 'analysis',
  summary: 'Observaciones',
  phase: 'debate',
  block: '—',
  nextStep: 'Pulsa Enter para continuar el análisis.',
  updatedAt: 't',
};

const STORY_ROW: StorySummary = {
  key: 'AQ-45',
  summary: 'Historia',
  phase: 'debate',
  block: 'spec',
  nextStep: 'Pulsa Enter',
  updatedAt: 't',
};

const POINT_ROWS = [fakePointRow('P1'), fakePointRow('P2')];

function setup(options: FakeAnalysisOptions = {}, stories: StorySummary[] = [ANALYSIS_ROW]) {
  const fakeAnalysis = createFakeAnalysis({ pointRows: POINT_ROWS, ...options });
  const utils = render(
    <App
      projectKey="AQ"
      stories={stories}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={async () => [{ key: EPIC, summary: 'Épica de pruebas', status: 'En curso' }]}
      fetchStories={async () => [
        { key: STORY_A, summary: 'Historia A', status: 'En curso' },
        { key: STORY_B, summary: 'Historia B', status: 'En curso' },
      ]}
      fetchProjects={async () => []}
      setProject={async () => ({ ok: true })}
      loadStories={async () => stories}
      chat={createFakeChat().chat}
      plan={createFakePlan().plan}
      tasks={createFakeTasks().tasks}
      analysis={fakeAnalysis.analysis}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  return { ...utils, frame, press, has, ...fakeAnalysis };
}

type App = ReturnType<typeof setup>;

async function openLink(app: App) {
  await app.has(HOME_TEXTS.title);
  await tick();
  await app.press('v');
}

// Con la épica ya vinculada: Enter la conserva y se llega a los puntos
async function openPointsKeepingEpic(app: App) {
  await openLink(app);
  await app.has(T.epicCurrent(EPIC));
  await tick();
  await app.press(ENTER);
  await app.has('[ ] P1');
  await tick();
}

test('el inicio muestra la épica vinculada del análisis', async () => {
  const app = setup({}, [{ ...ANALYSIS_ROW, linkedEpicKey: EPIC }]);
  await app.has(HOME_TEXTS.linkedTo(EPIC));
});

test('v sobre una historia avisa que vincular es solo de análisis', async () => {
  const app = setup({}, [STORY_ROW]);
  await app.has(HOME_TEXTS.title);
  await tick();
  await app.press('v');
  await app.has(HOME_TEXTS.onlyAnalysisLinkable);
  assert.ok(HOME_TEXTS.onlyAnalysisLinkable.length < 70);
});

test('todos los puntos a la épica: la elige, confirma con resumen y crea; el resultado muestra las claves', async () => {
  const app = setup();
  await openLink(app);
  await app.has(T.epicTitle);
  await tick();
  await app.press(ENTER);
  await app.has('[ ] P1');
  await tick();
  assert.deepEqual(app.calls.linkEpics, [EPIC]);
  assert.ok(app.frame().includes(`P1 · Punto P1 · 1h · pendiente · ${EPIC}`));
  await app.press('c');
  await app.has(T.group('P1, P2', EPIC, 'standard'));
  await tick();
  await app.press('s');
  await app.has(T.created('P1', 'AQ-100'));
  assert.deepEqual(app.calls.linkCreated, [{ P1: EPIC, P2: EPIC }]);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('una épica inválida se rechaza y no se guarda', async () => {
  const app = setup({ linkTargets: { [EPIC]: { ok: false, message: `${EPIC} no es una épica.` } } });
  await openLink(app);
  await app.has(T.epicTitle);
  await tick();
  await app.press(ENTER);
  await app.has(T.refused(`${EPIC} no es una épica.`));
  assert.deepEqual(app.calls.linkEpics, []);
});

test('grupos a dos historias distintas: el resumen agrupa por destino', async () => {
  const app = setup({ linkEpicKey: EPIC });
  await openPointsKeepingEpic(app);
  await app.press(' ');
  await app.press('e');
  await app.has(T.targetTitle);
  await tick();
  await app.press(DOWN);
  await app.press(ENTER);
  await app.has(T.targetSet(1, STORY_A));
  await tick();
  await app.press(DOWN);
  await app.press(' ');
  await app.press('e');
  await app.has(T.targetTitle);
  await tick();
  await app.press(DOWN);
  await app.press(DOWN);
  await app.press(ENTER);
  await app.has(T.targetSet(1, STORY_B));
  await tick();
  await app.press('c');
  await app.has(T.group('P1', STORY_A, 'subtask'));
  assert.ok(app.frame().includes(T.group('P2', STORY_B, 'subtask')));
  await app.press('s');
  await app.has(T.created('P1', 'AQ-100'));
  assert.deepEqual(app.calls.linkCreated, [{ P1: STORY_A, P2: STORY_B }]);
});

test('un punto sin destino se omite y se lista en el resumen', async () => {
  const app = setup();
  await openLink(app);
  await app.has(T.epicTitle);
  await tick();
  await app.press(ESC);
  await app.has('[ ] P1');
  await tick();
  await app.press('c');
  await app.has(T.nothingToCreate);
  await app.press(' ');
  await app.press('e');
  await app.has(T.targetTitle);
  await tick();
  await app.press('k');
  await app.has('Clave');
  await tick();
  await app.press(STORY_A);
  await app.press(ENTER);
  await app.has(T.targetSet(1, STORY_A));
  await tick();
  await app.press('c');
  await app.has(T.skipped('P2'));
  assert.ok(app.frame().includes(T.group('P1', STORY_A, 'subtask')));
});

test('un destino que Jira no acepta (subtarea) se rechaza con aviso', async () => {
  const app = setup({ linkTargets: { 'AQ-30': { ok: false, message: 'AQ-30 es una subtarea.' } } });
  await openLink(app);
  await app.has(T.epicTitle);
  await tick();
  await app.press(ESC);
  await app.has('[ ] P1');
  await tick();
  await app.press(' ');
  await app.press('e');
  await app.has(T.targetTitle);
  await tick();
  await app.press('k');
  await app.has('Clave');
  await tick();
  await app.press('AQ-30');
  await app.press(ENTER);
  await app.has(T.refused('AQ-30 es una subtarea.'));
});

test('un punto ya creado muestra su clave y no se puede marcar', async () => {
  const app = setup({
    linkEpicKey: EPIC,
    pointRows: [fakePointRow('P1', { issueKey: 'AQ-101' }), fakePointRow('P2')],
  });
  await openPointsKeepingEpic(app);
  assert.ok(app.frame().includes('AQ-101'));
  await app.press(' ');
  await app.has(T.fixed);
});

test('con fallos en el resultado se listan por punto con su mensaje', async () => {
  const app = setup({
    linkEpicKey: EPIC,
    linkResults: [
      { pointId: 'P1', ok: true, issueKey: 'AQ-100' },
      { pointId: 'P2', ok: false, message: 'caído' },
    ],
  });
  await openPointsKeepingEpic(app);
  await app.press('c');
  await app.has(T.confirm);
  await tick();
  await app.press('s');
  await app.has(T.failed('P2', 'caído'));
  assert.ok(app.frame().includes(T.summary(1, 1)));
});

async function openPoints(app: App) {
  await app.has(HOME_TEXTS.title);
  await tick();
  await app.press('t');
  await app.has(POINTS_TEXTS.title(ANALYSIS_ID, 'Observaciones'));
  await tick();
}

test('los puntos muestran la clave de Jira del punto vinculado', async () => {
  const app = setup({ pointRows: [fakePointRow('P1', { issueKey: 'AQ-101' })] });
  await openPoints(app);
  assert.ok(app.frame().includes('AQ-101'));
});

test('finalizar un punto vinculado avisa si Jira no se movió y el punto igual cambia', async () => {
  const app = setup({ pointRows: [fakePointRow('P1', { issueKey: 'AQ-101' })], pointNotice: 'No pude mover AQ-101' });
  await openPoints(app);
  await app.press('f');
  await app.has('No pude mover AQ-101');
  assert.deepEqual(app.calls.pointFinished, ['P1']);
});

test('devolver un punto vinculado ofrece las transiciones de Jira y usa la elegida', async () => {
  const app = setup({
    pointRows: [fakePointRow('P1', { issueKey: 'AQ-101', status: 'started' })],
    returnOptions: ['Por hacer', 'Bloqueada'],
  });
  await openPoints(app);
  await app.press('b');
  await app.has(POINTS_TEXTS.chooseReturn('P1'));
  await tick();
  await app.press(DOWN);
  await app.press(ENTER);
  await app.has(POINTS_TEXTS.returned('P1'));
  assert.deepEqual(app.calls.pointGivenBack, [{ pointId: 'P1', transitionName: 'Bloqueada' }]);
});

test('devolver un punto vinculado sin transiciones de Jira lo devuelve en jm y avisa', async () => {
  const app = setup({ pointRows: [fakePointRow('P1', { issueKey: 'AQ-101', status: 'started' })] });
  await openPoints(app);
  await app.press('b');
  await app.has(POINTS_TEXTS.jiraNotMoved('P1'));
  assert.deepEqual(app.calls.pointGivenBack, [{ pointId: 'P1', transitionName: undefined }]);
});

test('si Jira no reconoce el estado final pide elegir, lo aplica y muestra el resultado actualizado', async () => {
  const app = setup({
    linkEpicKey: EPIC,
    linkResults: [
      { pointId: 'P1', ok: true, issueKey: 'AQ-100', choose: { target: 'done', available: ['Hecho', 'Descartar'] } },
      { pointId: 'P2', ok: true, issueKey: 'AQ-101', choose: { target: 'done', available: ['Hecho', 'Descartar'] } },
    ],
    syncResults: [
      [
        { pointId: 'P1', ok: true, issueKey: 'AQ-100' },
        { pointId: 'P2', ok: true, issueKey: 'AQ-101' },
      ],
    ],
  });
  await openPointsKeepingEpic(app);
  await app.press('c');
  await app.has(T.confirm);
  await tick();
  await app.press('s');
  await app.has(T.chooseDone);
  await tick();
  await app.press(DOWN);
  await app.press(ENTER);
  await app.has(T.created('P2', 'AQ-101'));
  assert.deepEqual(app.calls.linkSynced, [{ target: 'done', name: 'Descartar' }]);
  assert.equal(app.frame().includes(T.notMoved('P1', 'AQ-100')), false);
});

test('cancelar la elección deja el punto sin mover y lo dice en el resultado', async () => {
  const app = setup({
    linkEpicKey: EPIC,
    linkResults: [{ pointId: 'P1', ok: true, issueKey: 'AQ-100', choose: { target: 'start', available: ['Hecho'] } }],
  });
  await openPointsKeepingEpic(app);
  await app.press('c');
  await app.has(T.confirm);
  await tick();
  await app.press('s');
  await app.has(T.chooseStart);
  await tick();
  await app.press(ESC);
  await app.has(T.notMoved('P1', 'AQ-100'));
});

test('s en la lista sincroniza los estados de lo ya vinculado y avisa si no hay nada que mover', async () => {
  const app = setup({
    linkEpicKey: EPIC,
    pointRows: [fakePointRow('P1', { issueKey: 'AQ-101', status: 'done' }), fakePointRow('P2')],
    syncResults: [[{ pointId: 'P1', ok: true, issueKey: 'AQ-101' }]],
  });
  await openPointsKeepingEpic(app);
  await app.press('s');
  await app.has(T.synced('P1', 'AQ-101'));
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
  await tick();
  await app.press('v');
  await app.has(T.epicCurrent(EPIC));
  await tick();
  await app.press(ENTER);
  await app.has('[ ] P1');
  await tick();
  await app.press('s');
  await app.has(T.syncNone);
  assert.equal(app.calls.linkSynced.length, 2);
});

test('finalizar un punto vinculado con estado desconocido pide la transición y la reintenta con la elegida', async () => {
  const app = setup({
    pointRows: [fakePointRow('P1', { issueKey: 'AQ-101' })],
    finishChoose: ['Hecho', 'Descartar'],
  });
  await openPoints(app);
  await app.press('f');
  await app.has(POINTS_TEXTS.chooseDone);
  await tick();
  await app.press(ENTER);
  await app.has(POINTS_TEXTS.finished('P1'));
  assert.deepEqual(app.calls.finishTransitions, [undefined, 'Hecho']);
});

test('iniciar un punto vinculado con estado desconocido pide la transición antes de abrir Claude', async () => {
  const app = setup({ pointRows: [fakePointRow('P1', { issueKey: 'AQ-101' })], startChoose: ['Arrancar', 'Otro'] });
  await openPoints(app);
  await app.press('i');
  await app.has(POINTS_TEXTS.chooseStart);
  await tick();
  await app.press(DOWN);
  await app.press(ENTER);
  await waitFor(() => app.calls.startTransitions.length > 0, 'start con transición');
  assert.deepEqual(app.calls.startTransitions, ['Otro']);
});
