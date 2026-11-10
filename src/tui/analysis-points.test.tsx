import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, type AppAction } from './app.js';
import type { PointFinishTarget } from '../refinement/analysis-types.js';
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
import { FOOTER_HINTS, HOME_TEXTS, POINTS_TEXTS as T } from './texts.js';

const ESC = '\u001b';
const TICK_MS = 60;
const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
const ANALYSIS_ID = 'an-1';

const ROW: StorySummary = {
  key: ANALYSIS_ID,
  kind: 'analysis',
  summary: 'Observaciones',
  phase: 'debate',
  block: '—',
  nextStep: 'Pulsa Enter para continuar el análisis.',
  updatedAt: 't',
};

interface SetupOptions extends FakeAnalysisOptions {
  initialPointFinish?: PointFinishTarget | null;
}

function setup({ initialPointFinish = null, ...options }: SetupOptions = {}) {
  const fakeAnalysis = createFakeAnalysis(options);
  const actions: AppAction[] = [];
  const utils = render(
    <App
      projectKey="AQ"
      stories={[ROW]}
      unlocked
      unlock={async () => ({ ok: true })}
      fetchEpics={async () => []}
      fetchStories={async () => []}
      fetchProjects={async () => []}
      setProject={async () => ({ ok: true })}
      loadStories={async () => [ROW]}
      chat={createFakeChat().chat}
      plan={createFakePlan().plan}
      tasks={createFakeTasks().tasks}
      analysis={fakeAnalysis.analysis}
      initialPointFinish={initialPointFinish}
      onAction={(action) => actions.push(action)}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  return { ...utils, frame, press, has, actions, ...fakeAnalysis };
}

async function openPoints(app: ReturnType<typeof setup>) {
  await app.has(HOME_TEXTS.title);
  await tick();
  await app.press('t');
  await app.has(T.title(ANALYSIS_ID, 'Observaciones'));
  await tick();
}

test('t sobre un análisis abre los puntos con estado, esperado y real; los fuera de alcance no aparecen', async () => {
  const app = setup({
    pointRows: [
      fakePointRow('P1', {
        status: 'started',
        estimateSeconds: 5400,
        realClaudeSeconds: 600,
        realElapsedSeconds: 1800,
      }),
      fakePointRow('P2', { status: 'done' }),
      fakePointRow('P3', { estimateSeconds: null }),
    ],
  });
  await openPoints(app);
  const frame = app.frame();
  assert.ok(frame.includes(T.line('P1', T.status.started, 'Punto P1', '1h30m', T.real('10m', '30m'))), frame);
  assert.ok(frame.includes(T.line('P2', T.status.done, 'Punto P2', '1h', T.noReal)), frame);
  assert.ok(frame.includes(T.line('P3', T.status.pending, 'Punto P3', T.noEstimate, T.noReal)), frame);
  assert.ok(frame.includes(T.summary(1, 3)));
  assert.ok(frame.includes(FOOTER_HINTS.points.slice(0, 20)), frame);
});

test('sin puntos.json la pantalla invita a abrir el análisis y debatir con Claude', async () => {
  const app = setup();
  await openPoints(app);
  await app.has('Este análisis aún no tiene puntos: ábrelo con Enter y debate con Claude.');
  await app.press('i');
  assert.equal(app.calls.pointStarted.length, 0);
});

test('un puntos.json inválido se explica sin tumbar la pantalla', async () => {
  const app = setup({ pointsInvalid: 'El punto P1: falta el campo "title"' });
  await openPoints(app);
  await app.has(T.invalid('El punto P1: falta el campo "title"'));
});

test('i inicia el punto elegido: pasa por el puente y pide abrir Claude con ese punto', async () => {
  const app = setup({ pointRows: [fakePointRow('P1'), fakePointRow('P2')] });
  await openPoints(app);
  await app.press('\u001b[B');
  await app.press('i');
  await waitFor(() => app.actions.length > 0, 'que pida abrir Claude');
  assert.deepEqual(app.calls.pointStarted, [{ id: ANALYSIS_ID, pointId: 'P2', reopen: false }]);
  assert.deepEqual(app.actions, [{ type: 'runPoint', analysisId: ANALYSIS_ID, pointId: 'P2' }]);
});

test('i sobre un punto finalizado pregunta si lo reabre; n no hace nada y s lo inicia', async () => {
  const app = setup({ pointRows: [fakePointRow('P1', { status: 'done' })] });
  await openPoints(app);
  await app.press('i');
  await app.has(T.reopenQuestion('P1'));
  await tick();
  await app.press('n');
  await app.has(T.title(ANALYSIS_ID, 'Observaciones'));
  assert.equal(app.actions.length, 0);

  await app.press('i');
  await app.has(T.reopenQuestion('P1'));
  await tick();
  await app.press('s');
  await waitFor(() => app.actions.length > 0, 'que pida abrir Claude');
  assert.deepEqual(app.calls.pointStarted, [{ id: ANALYSIS_ID, pointId: 'P1', reopen: true }]);
});

test('f finaliza el punto y b devuelve a pendiente el que está en curso', async () => {
  const app = setup({ pointRows: [fakePointRow('P1', { status: 'started' }), fakePointRow('P2')] });
  await openPoints(app);
  await app.press('b');
  await app.has(T.returned('P1'));
  await app.has(T.line('P1', T.status.pending, 'Punto P1', '1h', T.noReal));
  assert.deepEqual(app.calls.pointGivenBack, [{ pointId: 'P1', transitionName: undefined }]);

  await app.press('f');
  await app.has(T.finished('P1'));
  await app.has(T.line('P1', T.status.done, 'Punto P1', '1h', T.noReal));
  assert.deepEqual(app.calls.pointFinished, ['P1']);

  await app.press('f');
  await app.has(T.alreadyDone('P1'));
  assert.equal(app.calls.pointFinished.length, 1);
});

test('b sobre un punto pendiente avisa y no llama al puente', async () => {
  const app = setup({ pointRows: [fakePointRow('P1')] });
  await openPoints(app);
  await app.press('b');
  await app.has(T.notStarted('P1'));
  assert.equal(app.calls.pointGivenBack.length, 0);
});

test('al volver de Claude pregunta si terminó el punto: s lo finaliza, n lo deja en curso', async () => {
  const yes = setup({
    pointRows: [fakePointRow('P1', { status: 'started' })],
    initialPointFinish: { analysisId: ANALYSIS_ID, pointId: 'P1' },
  });
  await yes.has(T.finishQuestion('P1'));
  await tick();
  await yes.press('s');
  await yes.has(T.finished('P1'));
  assert.deepEqual(yes.calls.pointFinished, ['P1']);

  const no = setup({
    pointRows: [fakePointRow('P1', { status: 'started' })],
    initialPointFinish: { analysisId: ANALYSIS_ID, pointId: 'P1' },
  });
  await no.has(T.finishQuestion('P1'));
  await tick();
  await no.press('n');
  await no.has(T.keptInProgress('P1'));
  assert.equal(no.calls.pointFinished.length, 0);
});

test('Esc vuelve al inicio', async () => {
  const app = setup({ pointRows: [fakePointRow('P1')] });
  await openPoints(app);
  await app.press(ESC);
  await app.has(HOME_TEXTS.title);
});
