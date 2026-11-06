import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  advancePhase,
  emptyUsage,
  isValidIssueKey,
  ensureJmGitignore,
  ensureStory,
  listStoriesFrom,
  renderDashboardMarkdown,
  nextStepFor,
  readState,
  transitionPhase,
  updateState,
} from './state';
import { statePathOf, storeAt } from './test-support';

const listAt = async (root: string) => {
  const dir = path.join(root, '.jm', 'historias');
  const keys = fs.existsSync(dir) ? fs.readdirSync(dir).filter(isValidIssueKey) : [];
  return listStoriesFrom(keys.map((key) => ({ key, store: storeAt(root, key) })));
};

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jm-state-'));
}

test('ensureStory crea carpeta, bitácora y estado inicial', async () => {
  const root = await tempRoot();
  const state = await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', 'AQ-1');
  assert.equal(state.phase, 'spec');
  assert.equal(state.parentKey, 'AQ-1');
  assert.ok(await fs.pathExists(path.join(root, '.jm', 'historias', 'AQ-45', 'bitacora.md')));
    await assert.rejects(ensureStory(storeAt(root, 'mala clave'), 'mala clave', 'x', null), /inválida/);
});

test('transiciones: solo hacia adelante salvo reabrir', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  assert.equal((await transitionPhase(storeAt(root, 'AQ-45'), 'AQ-45', 'debate')).phase, 'debate');
  await assert.rejects(transitionPhase(storeAt(root, 'AQ-45'), 'AQ-45', 'spec'), /sin reabrir/);
  assert.equal((await transitionPhase(storeAt(root, 'AQ-45'), 'AQ-45', 'spec', { reopen: true })).phase, 'spec');
});

test('advancePhase no retrocede lo que avanzó la skill', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  await advancePhase(storeAt(root, 'AQ-45'), 'AQ-45', 'plan');
  assert.equal((await advancePhase(storeAt(root, 'AQ-45'), 'AQ-45', 'debate')).phase, 'plan');
});

test('updateState respeta fase y bloque escritos por la skill', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const file = statePathOf(root, 'AQ-45');
  const edited = await fs.readJson(file);
  await fs.writeJson(file, { ...edited, phase: 'debate', block: 'risks' });
  await updateState(storeAt(root, 'AQ-45'), 'AQ-45', (s) => {
    s.claudeSessionId = '123e4567-e89b-12d3-a456-426614174000';
  });
  const after = await readState(storeAt(root, 'AQ-45'), 'AQ-45');
  assert.equal(after?.phase, 'debate');
  assert.equal(after?.block, 'risks');
  assert.equal(after?.claudeSessionId, '123e4567-e89b-12d3-a456-426614174000');
});

test('listStories ordena por updatedAt descendente e ignora carpetas ajenas', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'Vieja', null);
  await ensureStory(storeAt(root, 'AQ-2'), 'AQ-2', 'Nueva', null);
  const old = await fs.readJson(statePathOf(root, 'AQ-1'));
  await fs.writeJson(statePathOf(root, 'AQ-1'), { ...old, updatedAt: '2020-01-01T00:00:00.000Z' });
  await fs.ensureDir(path.join(root, '.jm', 'historias', 'basura'));
  assert.deepEqual(
    (await listAt(root)).map((s) => s.key),
    ['AQ-2', 'AQ-1'],
  );
});

test('listStories devuelve vacío sin carpeta .jm', async () => {
  assert.deepEqual(await listAt(await tempRoot()), []);
});

test('nextStepFor menciona el bloque en debate', async () => {
  const root = await tempRoot();
  const state = await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  assert.match(nextStepFor({ ...state, phase: 'debate', block: 'risks' }), /riesgos.*jm refinar AQ-45/);
  assert.match(nextStepFor({ ...state, phase: 'plan' }), /Revisa el plan/);
});

test('renderDashboardMarkdown arma la tabla con las historias', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login | social', null);
  const md = renderDashboardMarkdown(await listAt(root));
  assert.ok(md.includes('| Clave | Resumen | Fase | Bloque | Siguiente paso | Actualizado |'));
  assert.ok(md.includes('| AQ-45 | Login \\| social | especificación | — |'));
});

const VALID_SESSION = '123e4567-e89b-12d3-a456-426614174000';

test('claudeSessionId malicioso se normaliza a null; uno válido se conserva', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const file = statePathOf(root, 'AQ-45');
  const base = await fs.readJson(file);
  await fs.writeJson(file, { ...base, claudeSessionId: 'x" & calc & "' });
  assert.equal((await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.claudeSessionId, null);
  await fs.writeJson(file, { ...base, claudeSessionId: VALID_SESSION });
  assert.equal((await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.claudeSessionId, VALID_SESSION);
});

test('raw.key se ignora: la clave sale de la carpeta', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const file = statePathOf(root, 'AQ-45');
  await fs.writeJson(file, { ...(await fs.readJson(file)), key: '../../evil' });
  assert.equal((await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.key, 'AQ-45');
  await updateState(storeAt(root, 'AQ-45'), 'AQ-45', (s) => {
    s.summary = 'otro';
  });
  assert.equal((await fs.readJson(file)).key, 'AQ-45');
});

test('descarta createdIssues y adjuntos inválidos', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const file = statePathOf(root, 'AQ-45');
  const good = { file: 'a.png', purpose: 'analysis', origin: 'jira', taskIds: ['T1'], uploaded: {} };
  await fs.writeJson(file, {
    ...(await fs.readJson(file)),
    createdIssues: { T1: 'AQ-50', T2: 7 },
    attachments: [good, { ...good, file: '../x.png' }, { ...good, purpose: 'otro' }, 'basura'],
  });
  const state = await readState(storeAt(root, 'AQ-45'), 'AQ-45');
  assert.deepEqual(state?.createdIssues, { T1: 'AQ-50' });
  assert.deepEqual(
    state?.attachments.map((a) => a.file),
    ['a.png'],
  );
});

test('un estado.json corrupto no impide listar las demás historias', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'Sana', null);
  await ensureStory(storeAt(root, 'AQ-2'), 'AQ-2', 'Rota', null);
  await fs.writeFile(statePathOf(root, 'AQ-2'), '{ no es json');
  const stories = await listAt(root);
  assert.deepEqual(stories.map((s) => s.key).sort(), ['AQ-1', 'AQ-2']);
  assert.match(stories.find((s) => s.key === 'AQ-2')?.summary ?? '', /estado ilegible.*AQ-2/);
});

test('fase desconocida: debate si hay avance, spec si no', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-1'), 'AQ-1', 'Sin avance', null);
  await ensureStory(storeAt(root, 'AQ-2'), 'AQ-2', 'Con bloque', null);
  for (const key of ['AQ-1', 'AQ-2']) {
    const base = await fs.readJson(statePathOf(root, key));
    await fs.writeJson(statePathOf(root, key), { ...base, phase: 'rara', block: key === 'AQ-2' ? 'scope' : null });
  }
  assert.equal((await readState(storeAt(root, 'AQ-1'), 'AQ-1'))?.phase, 'spec');
  assert.equal((await readState(storeAt(root, 'AQ-2'), 'AQ-2'))?.phase, 'debate');
});

test('adjuntos con nombre no saneado (., .., :, reservado) se descartan', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const file = statePathOf(root, 'AQ-45');
  const entry = (name: string) => ({ file: name, purpose: 'analysis', origin: 'jira', taskIds: [], uploaded: {} });
  await fs.writeJson(file, {
    ...(await fs.readJson(file)),
    attachments: ['.', '..', 'a:b', 'NUL.txt', 'ok.png'].map(entry),
  });
  assert.deepEqual(
    (await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.attachments.map((a) => a.file),
    ['ok.png'],
  );
});

test('el resumen leído de estado.json pierde los caracteres de control', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const file = statePathOf(root, 'AQ-45');
  await fs.writeJson(file, { ...(await fs.readJson(file)), summary: 'Hola\u001b[2J\nmundo' });
  assert.equal((await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.summary, 'Hola[2Jmundo');
});

test('ensureStory crea .jm/.gitignore con todas las líneas y no las duplica', async () => {
  const root = await tempRoot();
  const gitignore = path.join(root, '.jm', '.gitignore');
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  const expected =
    'historias/*/adjuntos/\nhistorias/*/conversacion.jsonl\nhistorias/*/.chat.jsonl\n';
  assert.equal(await fs.readFile(gitignore, 'utf8'), expected);
  await ensureStory(storeAt(root, 'AQ-46'), 'AQ-46', 'Otra', null);
  assert.equal(await fs.readFile(gitignore, 'utf8'), expected);
});

test('ensureJmGitignore agrega las líneas que faltan sin pisar las del dev', async () => {
  const root = await tempRoot();
  const gitignore = path.join(root, '.jm', '.gitignore');
  await fs.ensureDir(path.join(root, '.jm'));
  await fs.writeFile(gitignore, 'personalizado\nhistorias/*/adjuntos/');
  ensureJmGitignore(root);
  assert.equal(
    await fs.readFile(gitignore, 'utf8'),
    'personalizado\nhistorias/*/adjuntos/\nhistorias/*/conversacion.jsonl\nhistorias/*/.chat.jsonl\n',
  );
});

test('el uso acumulado se lee con validación: valores inválidos valen 0', async () => {
  const root = await tempRoot();
  await ensureStory(storeAt(root, 'AQ-45'), 'AQ-45', 'Login', null);
  assert.deepEqual((await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.usage, emptyUsage());
  const file = statePathOf(root, 'AQ-45');
  await fs.writeJson(file, {
    ...(await fs.readJson(file)),
    usage: { inputTokens: 10, outputTokens: -5, cacheReadTokens: 'x', costUsd: 0.5, turns: 2 },
  });
  assert.deepEqual((await readState(storeAt(root, 'AQ-45'), 'AQ-45'))?.usage, {
    inputTokens: 10,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.5,
    turns: 2,
  });
});

test('readState no lee la bitácora cuando estado.json ya trae la fase', async () => {
  const root = await tempRoot();
  const store = storeAt(root, 'AQ-45');
  await ensureStory(store, 'AQ-45', 'Login', null);
  const reads: string[] = [];
  const spying = {
    ...store,
    readText: async (name: string) => {
      reads.push(name);
      return store.readText(name);
    },
  };
  await readState(spying, 'AQ-45');
  assert.deepEqual(reads, ['estado.json']);
});

test('un índice caído no hace fallar la escritura del estado', async () => {
  const root = await tempRoot();
  const store = storeAt(root, 'AQ-45');
  await ensureStory(store, 'AQ-45', 'Login', null);
  store.onStoryChanged = async () => {
    throw new Error('bóveda caída');
  };
  const state = await transitionPhase(store, 'AQ-45', 'debate');
  assert.equal(state.phase, 'debate');
  assert.equal((await readState(store, 'AQ-45'))?.phase, 'debate');
});

test('updateState no reescribe el estado si la mutación no cambia nada', async () => {
  const root = await tempRoot();
  const store = storeAt(root, 'AQ-45');
  await ensureStory(store, 'AQ-45', 'Login', null);
  const writes: string[] = [];
  const spying = {
    ...store,
    writeText: async (name: string, content: string) => {
      writes.push(name);
      await store.writeText(name, content);
    },
  };
  await updateState(spying, 'AQ-45', () => undefined);
  assert.deepEqual(writes, []);
});

test('el inicio neutraliza enlaces, incrustaciones y HTML del resumen', () => {
  const story = {
    ...emptyStoryFor('AQ-45'),
    summary: '![[Private]] <img src=x>',
  };
  const markdown = renderDashboardMarkdown([story]);
  assert.ok(!markdown.includes('![[Private'));
  assert.ok(!markdown.includes(' <img'));
});

function emptyStoryFor(key: string) {
  return {
    key,
    summary: '',
    phase: 'spec' as const,
    block: null,
    claudeSessionId: null,
    parentKey: null,
    createdIssues: {},
    attachments: [],
    usage: emptyUsage(),
    updatedAt: '2026-11-05T10:00:00.000Z',
  };
}
