import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import {
  BASE_HEADER,
  createFakeChat,
  createFakePlan,
  createFakeTasks,
  FAKE_ASSIGNEE,
  FAKE_TARGET,
  type FakePlanOptions,
  fakeTask,
  waitFor,
} from './test-support.js';
import { AFTER_CHAT_TEXTS, CREATE_TEXTS, FINISH_TEXTS, HOME_TEXTS, MANUAL_KEY_TEXTS, PLAN_TEXTS } from './texts.js';
import type { StorySummary } from '../refinement/types.js';

const ENTER = '\r';
const VALID_PIN = '1234';
const TICK_MS = 30;

const NO_ITEMS = async () => [];
const noopProps = {
  chat: createFakeChat().chat,
  plan: createFakePlan().plan,
  unlock: async () => ({ ok: true }),
  fetchEpics: NO_ITEMS,
  fetchStories: NO_ITEMS,
  fetchProjects: NO_ITEMS,
  setProject: async () => ({ ok: true }),
  loadStories: async () => [],
};

const tick = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));

async function typePin(stdin: { write: (data: string) => void }, pin: string) {
  stdin.write(pin);
  await tick();
  stdin.write(ENTER);
  await tick();
}

test('muestra el inicio cuando el PIN es correcto', async () => {
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} {...noopProps} />);
  await typePin(stdin, VALID_PIN);
  await waitFor(() => (lastFrame() ?? '').includes(HOME_TEXTS.title));
  assert.ok((lastFrame() ?? '').includes('AQ'));
});

test('al ingresar el PIN recarga las historias (las de la base solo se leen con PIN)', async () => {
  const vaultStory = {
    key: 'PM-136',
    summary: 'Lista de insumos',
    phase: 'plan',
    block: '—',
    nextStep: 'Revisa el plan',
    updatedAt: '2026-11-05T10:00:00.000Z',
  };
  const { stdin, lastFrame } = render(
    <App projectKey="PM" stories={[]} {...noopProps} loadStories={async () => [vaultStory]} />,
  );
  await typePin(stdin, VALID_PIN);
  await waitFor(() => (lastFrame() ?? '').includes('PM-136'));
});

const STORIES = [
  {
    key: 'AQ-45',
    summary: 'Login social',
    phase: 'debate',
    block: 'riesgos',
    nextStep: 'Retoma el debate',
    updatedAt: '2026-11-04T10:00:00.000Z',
  },
  {
    key: 'AQ-46',
    summary: 'Reporte mensual',
    phase: 'plan',
    block: '—',
    nextStep: 'Revisa el plan',
    updatedAt: '2026-11-03T10:00:00.000Z',
  },
];
const DOWN = '[B';

test('lista las historias y Enter abre el chat de la historia elegida', async () => {
  const fake = createFakeChat();
  const { stdin, lastFrame } = render(
    <App projectKey="AQ" stories={STORIES} unlocked {...noopProps} chat={fake.chat} />,
  );
  const frame = lastFrame() ?? '';
  assert.ok(frame.includes('AQ-45') && frame.includes('AQ-46') && frame.includes('riesgos'));
  stdin.write(DOWN);
  await tick();
  stdin.write(ENTER);
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.opened, ['AQ-46']);
});

test('n y luego / abre la entrada de clave y rechaza una inválida', async () => {
  const fake = createFakeChat();
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} unlocked {...noopProps} chat={fake.chat} />);
  assert.ok((lastFrame() ?? '').includes(HOME_TEXTS.empty));
  stdin.write('n');
  await tick();
  stdin.write('/');
  await waitFor(() => (lastFrame() ?? '').includes(MANUAL_KEY_TEXTS.title));
  stdin.write('abc');
  await tick();
  stdin.write(ENTER);
  await waitFor(() => (lastFrame() ?? '').includes(MANUAL_KEY_TEXTS.invalidKey));
  assert.equal(fake.calls.opened.length, 0);
});

test('n y luego k abre la entrada de clave y acepta una válida en minúsculas', async () => {
  const fake = createFakeChat();
  const { stdin, lastFrame } = render(<App projectKey="AQ" stories={[]} unlocked {...noopProps} chat={fake.chat} />);
  stdin.write('n');
  await tick();
  stdin.write('k');
  await waitFor(() => (lastFrame() ?? '').includes(MANUAL_KEY_TEXTS.title));
  stdin.write('aq-9');
  await tick();
  stdin.write(ENTER);
  await waitFor(() => fake.calls.opened.length > 0);
  assert.deepEqual(fake.calls.opened, ['AQ-9']);
});

test('muestra el error y permite reintentar cuando el PIN es incorrecto', async () => {
  const message = 'PIN incorrecto';
  const { stdin, lastFrame } = render(
    <App projectKey="AQ" stories={[]} {...noopProps} unlock={async () => ({ ok: false, message })} />,
  );
  await typePin(stdin, VALID_PIN);
  await waitFor(() => (lastFrame() ?? '').includes(message));
  assert.ok(!(lastFrame() ?? '').includes(HOME_TEXTS.title));
});

const ESC = '';
const FLOW_STORY_KEY = 'AQ-45';
const FLOW_STORY_SUMMARY = 'Login social';
const CREATED = [{ taskId: 'T1', key: 'AQ-101', summary: 'Tarea T1', existing: false }];

const flowStory = (phaseId: StorySummary['phaseId']): StorySummary => ({
  key: FLOW_STORY_KEY,
  summary: FLOW_STORY_SUMMARY,
  phase: phaseId as string,
  phaseId,
  block: '—',
  nextStep: 'Siguiente',
  updatedAt: '2026-11-04T10:00:00.000Z',
});

function setupFlow(
  phaseId: StorySummary['phaseId'],
  planOptions: FakePlanOptions = {},
  fakeTasks?: ReturnType<typeof createFakeTasks>,
) {
  const fakePlan = createFakePlan({
    tasks: [fakeTask('T1')],
    outcomes: [{ ok: true, created: CREATED, parentKey: FLOW_STORY_KEY, estimateSkipped: false }],
    ...planOptions,
  });
  const chat = createFakeChat();
  const stories = [flowStory(phaseId)];
  const utils = render(
    <App
      projectKey="AQ"
      stories={stories}
      unlocked
      {...noopProps}
      loadStories={async () => stories}
      chat={chat.chat}
      plan={fakePlan.plan}
      tasks={fakeTasks?.tasks}
    />,
  );
  const frame = () => utils.lastFrame() ?? '';
  const press = async (data: string) => {
    utils.stdin.write(data);
    await tick();
  };
  const has = (text: string) => waitFor(() => frame().includes(text), `"${text}"`);
  const leaveChat = async () => {
    await press(ENTER);
    await waitFor(() => chat.calls.opened.length === 1, 'el chat abierto');
    chat.emit({ type: 'turnEnd', header: BASE_HEADER });
    await tick();
    await press(ESC);
  };
  return { ...utils, frame, press, has, leaveChat, planCalls: fakePlan.calls };
}

const PARENT_ASK = { kind: 'ask', reason: 'epic', epicKey: null, epicSummary: null } as const;
const EXISTING_MATCH = { taskId: 'T1', key: 'AQ-99', summary: 'Tarea T1' };

async function answerPlanReady(app: ReturnType<typeof setupFlow>, answer: string) {
  await app.leaveChat();
  await app.has(AFTER_CHAT_TEXTS.planReadyQuestion(FLOW_STORY_KEY));
  await app.press(answer);
}

test('con el plan listo, s crea las tareas directo en Jira con los valores por defecto y avisa', async () => {
  const app = setupFlow('plan');
  await answerPlanReady(app, 's');
  await app.has(HOME_TEXTS.title);
  await app.has(AFTER_CHAT_TEXTS.created(CREATED.length, FLOW_STORY_KEY));
  assert.deepEqual(app.planCalls.created, [{ target: FAKE_TARGET, assigneeId: FAKE_ASSIGNEE.accountId, adopt: {} }]);
});

test('con el plan listo, s con el padre por elegir abre la revisión y explica por qué', async () => {
  const app = setupFlow('plan', { preview: { parent: PARENT_ASK } });
  await answerPlanReady(app, 's');
  await app.has(PLAN_TEXTS.title(FLOW_STORY_KEY, FLOW_STORY_SUMMARY));
  await app.has(AFTER_CHAT_TEXTS.needsParent(FLOW_STORY_KEY));
  assert.equal(app.planCalls.created.length, 0);
});

test('con el plan listo, s con coincidencias en Jira abre la revisión y no crea', async () => {
  const app = setupFlow('reviewed', { preview: { existing: [EXISTING_MATCH] } });
  await answerPlanReady(app, 's');
  await app.has(PLAN_TEXTS.title(FLOW_STORY_KEY, FLOW_STORY_SUMMARY));
  await app.has(AFTER_CHAT_TEXTS.hasExisting(FLOW_STORY_KEY));
  assert.equal(app.planCalls.created.length, 0);
});

test('con el plan listo, si crear falla vuelve al inicio con el error y cómo reintentar', async () => {
  const failure = { ok: false, message: 'Jira 500', created: CREATED } as const;
  const app = setupFlow('plan', { outcomes: [failure] });
  await answerPlanReady(app, 's');
  await app.has(HOME_TEXTS.title);
  await app.has('Jira 500');
  assert.equal(app.planCalls.created.length, 1);
});

test('con el plan listo, n vuelve al inicio y avisa cómo crearlas después', async () => {
  const app = setupFlow('reviewed');
  await answerPlanReady(app, 'n');
  await app.has(HOME_TEXTS.title);
  await app.has(AFTER_CHAT_TEXTS.planReadyLater(FLOW_STORY_KEY));
  assert.equal(app.planCalls.created.length, 0);
});

test('al salir del chat en debate no pregunta y vuelve al inicio', async () => {
  const app = setupFlow('debate');
  await app.leaveChat();
  await app.has(HOME_TEXTS.title);
  assert.ok(!app.frame().includes(AFTER_CHAT_TEXTS.planReadyQuestion(FLOW_STORY_KEY)));
});

test('tras la Planificación abierta y terminarla, con el plan listo ofrece crear las tareas', async () => {
  const app = setupFlow('plan', {}, createFakeTasks({ planningOpen: 'AQ-140' }));
  await app.leaveChat();
  await app.has(FINISH_TEXTS.question('AQ-140'));
  await app.press('s');
  await app.has(AFTER_CHAT_TEXTS.planReadyQuestion(FLOW_STORY_KEY));
  await app.press('s');
  await app.has(AFTER_CHAT_TEXTS.created(CREATED.length, FLOW_STORY_KEY));
  assert.equal(app.planCalls.created.length, 1);
});

test('con el plan listo, s sin tareas marcadas abre la revisión y explica por qué', async () => {
  const app = setupFlow('plan', { preview: { taskCount: 0 } });
  await answerPlanReady(app, 's');
  await app.has(PLAN_TEXTS.title(FLOW_STORY_KEY, FLOW_STORY_SUMMARY));
  await app.has(AFTER_CHAT_TEXTS.noTasks(FLOW_STORY_KEY));
  assert.equal(app.planCalls.created.length, 0);
});

test('historia con tareas ya creadas y una nueva en el plan: ofrece crear solo esa y s la crea', async () => {
  const app = setupFlow('in-progress', { pendingTasks: 1 });
  await app.leaveChat();
  await app.has(AFTER_CHAT_TEXTS.newTasksQuestion(FLOW_STORY_KEY, 1));
  await app.press('s');
  await app.has(AFTER_CHAT_TEXTS.created(CREATED.length, FLOW_STORY_KEY));
  assert.equal(app.planCalls.created.length, 1);
});

test('historia con tareas creadas y varias nuevas: la pregunta dice cuántas', async () => {
  const app = setupFlow('created', { pendingTasks: 3 });
  await app.leaveChat();
  await app.has(AFTER_CHAT_TEXTS.newTasksQuestion(FLOW_STORY_KEY, 3));
});

test('historia con tareas creadas y sin nuevas en el plan: no pregunta y vuelve al inicio', async () => {
  const app = setupFlow('in-progress');
  await app.leaveChat();
  await app.has(HOME_TEXTS.title);
  assert.ok(!app.frame().includes(AFTER_CHAT_TEXTS.newTasksQuestion(FLOW_STORY_KEY, 1)));
  assert.equal(app.planCalls.created.length, 0);
});

test('con el plan listo, si Jira no acepta estimación el aviso lo dice', async () => {
  const outcome = { ok: true, created: CREATED, parentKey: FLOW_STORY_KEY, estimateSkipped: true } as const;
  const app = setupFlow('plan', { outcomes: [outcome] });
  await answerPlanReady(app, 's');
  await app.has(HOME_TEXTS.title);
  await app.has(CREATE_TEXTS.estimateSkipped.slice(0, 30));
});
