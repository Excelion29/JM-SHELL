import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  advancePhase,
  dashboardPath,
  ensureStory,
  listStories,
  nextStepFor,
  readState,
  renderDashboard,
  statePath,
  transitionPhase,
  updateState,
} from './state';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jdf-state-'));
}

test('ensureStory crea carpeta, bitácora y estado inicial', async () => {
  const root = await tempRoot();
  const state = await ensureStory(root, 'AQ-45', 'Login', 'AQ-1');
  assert.equal(state.phase, 'spec');
  assert.equal(state.parentKey, 'AQ-1');
  assert.ok(await fs.pathExists(path.join(root, '.jdf', 'historias', 'AQ-45', 'bitacora.md')));
  assert.ok(await fs.pathExists(path.join(root, '.jdf', 'historias', 'AQ-45', 'adjuntos')));
  await assert.rejects(ensureStory(root, 'mala clave', 'x', null), /inválida/);
});

test('transiciones: solo hacia adelante salvo reabrir', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  assert.equal((await transitionPhase(root, 'AQ-45', 'debate')).phase, 'debate');
  await assert.rejects(transitionPhase(root, 'AQ-45', 'spec'), /sin reabrir/);
  assert.equal((await transitionPhase(root, 'AQ-45', 'spec', { reopen: true })).phase, 'spec');
});

test('advancePhase no retrocede lo que avanzó la skill', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  await advancePhase(root, 'AQ-45', 'plan');
  assert.equal((await advancePhase(root, 'AQ-45', 'debate')).phase, 'plan');
});

test('updateState respeta fase y bloque escritos por la skill', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = statePath(root, 'AQ-45');
  const edited = await fs.readJson(file);
  await fs.writeJson(file, { ...edited, phase: 'debate', block: 'risks' });
  await updateState(root, 'AQ-45', (s) => {
    s.claudeSessionId = '123e4567-e89b-12d3-a456-426614174000';
  });
  const after = await readState(root, 'AQ-45');
  assert.equal(after?.phase, 'debate');
  assert.equal(after?.block, 'risks');
  assert.equal(after?.claudeSessionId, '123e4567-e89b-12d3-a456-426614174000');
});

test('listStories ordena por updatedAt descendente e ignora carpetas ajenas', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-1', 'Vieja', null);
  await ensureStory(root, 'AQ-2', 'Nueva', null);
  const old = await fs.readJson(statePath(root, 'AQ-1'));
  await fs.writeJson(statePath(root, 'AQ-1'), { ...old, updatedAt: '2020-01-01T00:00:00.000Z' });
  await fs.ensureDir(path.join(root, '.jdf', 'historias', 'basura'));
  assert.deepEqual(
    (await listStories(root)).map((s) => s.key),
    ['AQ-2', 'AQ-1'],
  );
});

test('listStories devuelve vacío sin carpeta .jdf', async () => {
  assert.deepEqual(await listStories(await tempRoot()), []);
});

test('nextStepFor menciona el bloque en debate', async () => {
  const root = await tempRoot();
  const state = await ensureStory(root, 'AQ-45', 'Login', null);
  assert.match(nextStepFor({ ...state, phase: 'debate', block: 'risks' }), /riesgos.*jdf refinar AQ-45/);
  assert.match(nextStepFor({ ...state, phase: 'plan' }), /Revisa el plan/);
});

test('renderDashboard escribe INICIO.md con la tabla', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login | social', null);
  await renderDashboard(root);
  const md = await fs.readFile(dashboardPath(root), 'utf8');
  assert.ok(md.includes('| Clave | Resumen | Fase | Bloque | Siguiente paso | Actualizado |'));
  assert.ok(md.includes('| AQ-45 | Login \\| social | especificación | — |'));
});

const VALID_SESSION = '123e4567-e89b-12d3-a456-426614174000';

test('claudeSessionId malicioso se normaliza a null; uno válido se conserva', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = statePath(root, 'AQ-45');
  const base = await fs.readJson(file);
  await fs.writeJson(file, { ...base, claudeSessionId: 'x" & calc & "' });
  assert.equal((await readState(root, 'AQ-45'))?.claudeSessionId, null);
  await fs.writeJson(file, { ...base, claudeSessionId: VALID_SESSION });
  assert.equal((await readState(root, 'AQ-45'))?.claudeSessionId, VALID_SESSION);
});

test('raw.key se ignora: la clave sale de la carpeta', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = statePath(root, 'AQ-45');
  await fs.writeJson(file, { ...(await fs.readJson(file)), key: '../../evil' });
  assert.equal((await readState(root, 'AQ-45'))?.key, 'AQ-45');
  await updateState(root, 'AQ-45', (s) => {
    s.summary = 'otro';
  });
  assert.equal((await fs.readJson(file)).key, 'AQ-45');
});

test('descarta createdIssues y adjuntos inválidos', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = statePath(root, 'AQ-45');
  const good = { file: 'a.png', purpose: 'analysis', origin: 'jira', taskIds: ['T1'], uploaded: {} };
  await fs.writeJson(file, {
    ...(await fs.readJson(file)),
    createdIssues: { T1: 'AQ-50', T2: 7 },
    attachments: [good, { ...good, file: '../x.png' }, { ...good, purpose: 'otro' }, 'basura'],
  });
  const state = await readState(root, 'AQ-45');
  assert.deepEqual(state?.createdIssues, { T1: 'AQ-50' });
  assert.deepEqual(
    state?.attachments.map((a) => a.file),
    ['a.png'],
  );
});

test('un estado.json corrupto no impide listar las demás historias', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-1', 'Sana', null);
  await ensureStory(root, 'AQ-2', 'Rota', null);
  await fs.writeFile(statePath(root, 'AQ-2'), '{ no es json');
  const stories = await listStories(root);
  assert.deepEqual(stories.map((s) => s.key).sort(), ['AQ-1', 'AQ-2']);
  assert.match(stories.find((s) => s.key === 'AQ-2')?.summary ?? '', /estado ilegible.*AQ-2/);
});

test('fase desconocida: debate si hay avance, spec si no', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-1', 'Sin avance', null);
  await ensureStory(root, 'AQ-2', 'Con bloque', null);
  for (const key of ['AQ-1', 'AQ-2']) {
    const base = await fs.readJson(statePath(root, key));
    await fs.writeJson(statePath(root, key), { ...base, phase: 'rara', block: key === 'AQ-2' ? 'scope' : null });
  }
  assert.equal((await readState(root, 'AQ-1'))?.phase, 'spec');
  assert.equal((await readState(root, 'AQ-2'))?.phase, 'debate');
});

test('adjuntos con nombre no saneado (., .., :, reservado) se descartan', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = statePath(root, 'AQ-45');
  const entry = (name: string) => ({ file: name, purpose: 'analysis', origin: 'jira', taskIds: [], uploaded: {} });
  await fs.writeJson(file, {
    ...(await fs.readJson(file)),
    attachments: ['.', '..', 'a:b', 'NUL.txt', 'ok.png'].map(entry),
  });
  assert.deepEqual(
    (await readState(root, 'AQ-45'))?.attachments.map((a) => a.file),
    ['ok.png'],
  );
});

test('el resumen leído de estado.json pierde los caracteres de control', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = statePath(root, 'AQ-45');
  await fs.writeJson(file, { ...(await fs.readJson(file)), summary: 'Hola\u001b[2J\nmundo' });
  assert.equal((await readState(root, 'AQ-45'))?.summary, 'Hola[2Jmundo');
});
