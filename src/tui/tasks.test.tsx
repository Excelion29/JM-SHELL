import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import type { StorySummary } from '../refinement/types.js';
import { App, type AppAction } from './app.js';
import {
  createFakeChat,
  createFakePlan,
  createFakeTasks,
  EMPTY_CALIBRATION,
  FakeTasksOptions,
  fakeRow,
  waitFor,
} from './test-support.js';
import {
  CALIBRATION_TEXTS,
  DELETE_CONFIRM_WORD,
  FINISH_TEXTS,
  HOME_TEXTS,
  MY_DAY_TEXTS,
  TASKS_TEXTS,
} from './texts.js';

const ENTER = '\r';
const ESC = '\u001b';
const DOWN = '\u001b[B';
const TICK_MS = 30;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const DONE_ROW = fakeRow('AQ-103', { status: 'Finalizada', category: 'done' });
const EXTRA_ROW = fakeRow('AQ-104', { inPlan: false, assignee: 'Luis Gómez' });

const story = (phaseId: StorySummary['phaseId']): StorySummary => ({
  key: 'AQ-45',
  summary: 'Login social',
  phase: phaseId as string,
  phaseId,
  block: '—',
  nextStep: 'Siguiente',
  updatedAt: '2026-11-04T10:00:00.000Z',
});

const NO_ITEMS = async () => [];

function setup(options: FakeTasksOptions = {}, phaseId: StorySummary['phaseId'] = 'created', finish = false) {
  const fake = createFakeTasks(options);
  const stories = [story(phaseId)];
  const actions: AppAction[] = [];
  const utils = render(
    <App
      projectKey="AQ"
      stories={stories}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={NO_ITEMS}
      fetchStories={NO_ITEMS}
      fetchProjects={NO_ITEMS}
      setProject={async () => ({ ok: true })}
      loadStories={async () => stories}
      chat={createFakeChat().chat}
      plan={createFakePlan().plan}
      tasks={fake.tasks}
      initialTaskFinish={finish ? { storyKey: 'AQ-45', issueKey: 'AQ-101' } : null}
      onAction={(a) => actions.push(a)}
    />,
  );
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const frame = () => utils.lastFrame() ?? '';
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  return { ...utils, press, frame, has, actions, ...fake };
}

async function openTasks(options: FakeTasksOptions = {}) {
  const app = setup(options);
  await app.press('t');
  await app.has(TASKS_TEXTS.title('AQ-45', 'Login social'));
  return app;
}

test('t abre las tareas solo con la historia creada o en curso', async () => {
  const plan = setup({}, 'plan');
  await plan.press('t');
  assert.ok(plan.frame().includes(HOME_TEXTS.title));
  for (const phase of ['created', 'in-progress'] as const) {
    const app = setup({}, phase);
    await app.press('t');
    await app.has(TASKS_TEXTS.title('AQ-45', 'Login social'));
  }
});

test('la lista muestra asignado, lo que no es del plan y el resumen; p filtra pendientes', async () => {
  const app = await openTasks({ rows: [fakeRow('AQ-101'), DONE_ROW, EXTRA_ROW] });
  const frame = app.frame();
  assert.ok(frame.includes('Luis Gómez') && frame.includes(TASKS_TEXTS.notInPlan));
  assert.ok(frame.includes(TASKS_TEXTS.summary(1, 3, '2h')));
  await app.press('p');
  assert.ok(!app.frame().includes('AQ-103'));
  assert.ok(app.frame().includes(TASKS_TEXTS.filterOn));
});

test('la lista pone primero lo en curso, luego lo por hacer y al final lo finalizado', async () => {
  const app = await openTasks({
    rows: [DONE_ROW, fakeRow('AQ-101'), fakeRow('AQ-102', { status: 'En curso', category: 'indeterminate' })],
  });
  const frame = app.frame();
  const at = (key: string) => frame.indexOf(key);
  assert.ok(at('AQ-102') < at('AQ-101') && at('AQ-101') < at('AQ-103'), frame);
});

test('i inicia la tarea y pide abrir Claude con la historia y la subtarea', async () => {
  const app = await openTasks();
  await app.press('i');
  await waitFor(() => app.actions.length === 1, 'la acción');
  assert.deepEqual(app.actions[0], { type: 'runTask', storyKey: 'AQ-45', issueKey: 'AQ-102' });
});

test('si Jira falla al iniciar se avisa y no se abre Claude', async () => {
  const app = await openTasks({ start: [{ kind: 'failed', message: 'Jira caído' }] });
  await app.press('i');
  await app.has('Jira caído');
  assert.equal(app.actions.length, 0);
});

test('sin la transición esperada se muestra el selector y se aplica la elegida', async () => {
  const app = await openTasks({ start: [{ kind: 'choose', available: ['Backlog', 'Revisión'] }] });
  await app.press('i');
  await app.has(TASKS_TEXTS.chooseTransition);
  await app.press(DOWN);
  await app.press(ENTER);
  await waitFor(() => app.actions.length === 1, 'la acción');
  assert.equal(app.calls.started[1].options.transitionName, 'Revisión');
});

test('cancelar el selector de transición no abre Claude', async () => {
  const app = await openTasks({ start: [{ kind: 'choose', available: ['Backlog', 'Revisión'] }] });
  await app.press('i');
  await app.has(TASKS_TEXTS.chooseTransition);
  await app.press(ESC);
  assert.equal(app.actions.length, 0);
  assert.equal(app.calls.started.length, 1);
});

test('una tarea finalizada pregunta antes de reabrir: n cancela y s reabre', async () => {
  const app = await openTasks({ start: [{ kind: 'needs-reopen' }, { kind: 'needs-reopen' }] });
  await app.press('i');
  await app.has(TASKS_TEXTS.reopenQuestion('AQ-102'));
  await app.press('n');
  assert.equal(app.actions.length, 0);
  await app.press('i');
  await app.has(TASKS_TEXTS.reopenQuestion('AQ-102'));
  await app.press('s');
  await waitFor(() => app.actions.length === 1, 'la acción');
  assert.equal(app.calls.started.at(-1)?.options.reopen, true);
});

test('espacio no marca finalizadas ni en curso y lo explica', async () => {
  const app = await openTasks({ rows: [DONE_ROW, fakeRow('AQ-102', { category: 'indeterminate' })] });
  await app.press(' ');
  await app.has(TASKS_TEXTS.inProgressBlocked('AQ-102'));
  await app.press(DOWN);
  await app.press(' ');
  await app.has(TASKS_TEXTS.doneBlocked('AQ-103'));
});

test('borrar muestra la lista exacta y exige escribir la palabra completa', async () => {
  const app = await openTasks({ rows: [fakeRow('AQ-101'), EXTRA_ROW] });
  await app.press(' ');
  await app.press(DOWN);
  await app.press(' ');
  await app.press('d');
  await app.has(TASKS_TEXTS.deleteTitle);
  assert.ok(app.frame().includes('AQ-101') && app.frame().includes('AQ-104') && app.frame().includes('Luis Gómez'));
  await app.press('borra');
  await app.press(ENTER);
  await app.has(TASKS_TEXTS.deleteMismatch);
  assert.deepEqual(app.calls.removed, []);

  await app.press('d');
  await app.press(DELETE_CONFIRM_WORD);
  await app.press(ENTER);
  await app.has(TASKS_TEXTS.deleteDone(2, 0));
  assert.deepEqual(app.calls.removed, [['AQ-101', 'AQ-104']]);
});

test('un permiso denegado se informa por tarea sin ocultar las borradas', async () => {
  const app = await openTasks({
    rows: [fakeRow('AQ-101'), EXTRA_ROW],
    removeResults: { 'AQ-101': { key: 'AQ-101', ok: false, message: 'Permission denied' } },
  });
  await app.press(' ');
  await app.press(DOWN);
  await app.press(' ');
  await app.press('d');
  await app.press(DELETE_CONFIRM_WORD);
  await app.press(ENTER);
  await app.has(TASKS_TEXTS.deleteDone(1, 1));
  assert.ok(app.frame().includes(TASKS_TEXTS.deleteFailLine('AQ-101', 'Permission denied')));
});

test('b devuelve una tarea en curso con la transición elegida y luego se puede marcar', async () => {
  const app = await openTasks({ rows: [fakeRow('AQ-102', { status: 'En curso', category: 'indeterminate' })] });
  await app.press('b');
  await app.has(TASKS_TEXTS.chooseReturn('AQ-102'));
  await app.press(ENTER);
  await app.has(TASKS_TEXTS.returned('AQ-102', 'Backlog'));
  assert.deepEqual(app.calls.returned, [{ key: 'AQ-102', name: 'Backlog' }]);
  await app.press(' ');
  assert.ok(app.frame().includes('[x]'));
});

test('r actualiza y reintenta los cierres pendientes', async () => {
  const app = await openTasks({ rows: [fakeRow('AQ-102', { pendingDone: true })] });
  await app.press('r');
  await app.has(TASKS_TEXTS.retryDone(1, 0));
  assert.equal(app.calls.retried, 1);
});

test('v muestra el plan en solo lectura: espacio no cambia nada', async () => {
  const app = await openTasks();
  await app.press('v');
  await app.has('Revisión del plan');
  await app.press(' ');
  await app.press('c');
  assert.ok(app.frame().includes('[x] T1'));
  assert.ok(!app.frame().includes('Crear en Jira'));
  await app.press(ESC);
  await app.has(TASKS_TEXTS.title('AQ-45', 'Login social'));
});

test('al volver de Claude pregunta si terminó: s la finaliza', async () => {
  const app = setup({}, 'in-progress', true);
  await app.has(FINISH_TEXTS.question('AQ-101'));
  await app.press('s');
  await app.has(FINISH_TEXTS.done('AQ-101'));
  assert.equal(app.calls.finished.length, 1);
});

test('al volver de Claude, n deja la tarea en curso sin tocar Jira', async () => {
  const app = setup({}, 'in-progress', true);
  await app.has(FINISH_TEXTS.question('AQ-101'));
  await app.press('n');
  await app.has(FINISH_TEXTS.keptInProgress('AQ-101'));
  assert.equal(app.calls.finished.length, 0);
});

test('f finaliza la tarea del cursor sin abrir Claude tras confirmar con s', async () => {
  const app = await openTasks();
  await app.press('f');
  await app.has(FINISH_TEXTS.directQuestion);
  assert.ok(app.frame().includes('AQ-102'));
  await app.press('s');
  await app.has(FINISH_TEXTS.directSummary(1, []));
  assert.deepEqual(app.calls.finished, [{ key: 'AQ-102', options: { direct: true } }]);
  assert.equal(app.actions.length, 0);
});

test('f con varias marcadas muestra la lista exacta, omite las finalizadas y sigue tras un error', async () => {
  const app = await openTasks({
    rows: [fakeRow('AQ-101'), fakeRow('AQ-104'), fakeRow('AQ-105')],
    finish: [{ kind: 'failed', message: 'sin permiso' }],
  });
  await app.press(' ');
  await app.press(DOWN);
  await app.press(' ');
  await app.press(DOWN);
  await app.press(' ');
  await app.press('f');
  await app.has(FINISH_TEXTS.directQuestion);
  assert.ok(['AQ-101', 'AQ-104', 'AQ-105'].every((k) => app.frame().includes(k)));
  await app.press('s');
  await app.has(FINISH_TEXTS.directSummary(2, ['AQ-101: sin permiso']));
  assert.equal(app.calls.finished.length, 3);
});

test('f sobre una finalizada no hace nada en Jira y lo avisa', async () => {
  const app = await openTasks({ rows: [DONE_ROW] });
  await app.press('f');
  await app.has(FINISH_TEXTS.directNothing);
  assert.equal(app.calls.finished.length, 0);
});

test('f sin la transición esperada muestra el selector y reintenta con la elegida', async () => {
  const app = await openTasks({ finish: [{ kind: 'choose', available: ['Backlog', 'Revisión'] }] });
  await app.press('f');
  await app.press('s');
  await app.has(FINISH_TEXTS.chooseTransition);
  await app.press(DOWN);
  await app.press(ENTER);
  await app.has(FINISH_TEXTS.directSummary(1, []));
  assert.deepEqual(app.calls.finished[1].options, { direct: true, transitionName: 'Revisión' });
});

test('f en Mi día finaliza la tarea del cursor', async () => {
  const row = {
    key: 'ZZ-9',
    title: 'Arreglar login',
    parentKey: 'ZZ-1',
    status: 'Por hacer',
    category: 'new' as const,
    estimateSeconds: 9000,
    dueDate: '2026-11-04',
    overdue: true,
  };
  const app = setup({ myDay: { rows: [row], totalSeconds: 9000, capacitySeconds: 28800 } });
  await app.press('h');
  await app.has('ZZ-9');
  await app.press('f');
  await app.has(FINISH_TEXTS.directQuestion);
  await app.press('s');
  await waitFor(() => app.calls.finished.length === 1, 'el cierre');
  assert.deepEqual(app.calls.finished[0], { key: 'ZZ-9', options: { direct: true } });
});

test('Mi día lista lo asignado con el total contra las 8 h e inicia la tarea', async () => {
  const row = {
    key: 'ZZ-9',
    title: 'Arreglar login',
    parentKey: 'ZZ-1',
    status: 'Por hacer',
    category: 'new' as const,
    estimateSeconds: 9000,
    dueDate: '2026-11-04',
    overdue: true,
  };
  const app = setup({ myDay: { rows: [row], totalSeconds: 9000, capacitySeconds: 28800 } });
  await app.press('h');
  await app.has(MY_DAY_TEXTS.total('2h30m', '8h'));
  assert.ok(app.frame().includes('ZZ-9') && app.frame().includes(MY_DAY_TEXTS.overdue));
  await app.press('i');
  await waitFor(() => app.actions.length === 1, 'la acción');
  assert.deepEqual(app.actions[0], { type: 'runTask', storyKey: 'ZZ-1', issueKey: 'ZZ-9' });
});

test('la columna real muestra Claude abierto / inicio a fin y el resumen compara lo medido', async () => {
  const measured = fakeRow('AQ-103', {
    status: 'Finalizada',
    category: 'done',
    estimateSeconds: 3600,
    realClaudeSeconds: 2700,
    realElapsedSeconds: 3 * 3600,
  });
  const app = await openTasks({ rows: [fakeRow('AQ-101'), measured] });
  const frame = app.frame();
  assert.ok(frame.includes(TASKS_TEXTS.real('45m', '3h')), frame);
  assert.ok(frame.includes(TASKS_TEXTS.measured(1, '1h', '45m', '3h')), frame);
});

test('en curso sin finalizadas medidas se ve la leyenda de la columna real; sin tiempos, nada', async () => {
  const app = await openTasks();
  assert.ok(!app.frame().includes(TASKS_TEXTS.realLegend));
  const started = fakeRow('AQ-102', { category: 'indeterminate', realClaudeSeconds: 600, realElapsedSeconds: 900 });
  const running = await openTasks({ rows: [started] });
  assert.ok(running.frame().includes(TASKS_TEXTS.realLegend));
  assert.ok(running.frame().includes(TASKS_TEXTS.real('10m', '15m')));
});

test('c abre la calibración: ratios por medida y por riesgo, desviadas y excluidas; Esc vuelve', async () => {
  const group = {
    count: 2,
    estimateSeconds: 7200,
    claudeSeconds: 5400,
    elapsedSeconds: 14400,
    claudeRatio: 0.75,
    elapsedRatio: 2,
  };
  const app = setup({
    calibration: {
      planning: { count: 0, estimateSeconds: 0, elapsedSeconds: 0 },
      analysisPoints: { count: 2, estimateSeconds: 7200, elapsedSeconds: 5400 },
      total: group,
      byRisk: [{ risk: 'low', ...group }],
      outliers: [
        {
          key: 'AQ-101',
          storyKey: 'AQ-45',
          title: 'Login',
          estimateSeconds: 3600,
          claudeSeconds: 1800,
          elapsedSeconds: 7200,
        },
      ],
      excludedDirect: 1,
      unreadable: 0,
    },
  });
  await app.press('c');
  await app.has(CALIBRATION_TEXTS.title);
  const frame = app.frame();
  assert.ok(frame.includes(CALIBRATION_TEXTS.claudeRatio('0,75')), frame);
  assert.ok(frame.includes(CALIBRATION_TEXTS.elapsedRatio('2,00')));
  assert.ok(frame.includes(CALIBRATION_TEXTS.riskLine('bajo', 2, '0,75', '2,00')));
  assert.ok(frame.includes(CALIBRATION_TEXTS.outlierLine('AQ-101', 'Login', '1h', '30m', '2h')));
  assert.ok(frame.includes(CALIBRATION_TEXTS.excludedDirect(1)));
  assert.ok(frame.includes(CALIBRATION_TEXTS.analysisPoints(2, '2h', '1h30m')), frame);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});

test('c sin tareas medidas lo explica', async () => {
  const app = setup({ calibration: EMPTY_CALIBRATION });
  await app.press('c');
  await app.has(CALIBRATION_TEXTS.empty);
});
