import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ANALYSIS_STATE_FILE, createAnalysis, nextAnalysisId, readAnalysis, updateAnalysis } from './analysis';
import { removeAnalysis, removeAnalysisWorkCopies } from './analysis-remove';
import { createAnalysisProjectStore } from './project-store';
import { CHAT_FILE } from './state';
import { tempRoot } from './test-support';
import { WORK_ANALYSIS_DIR, WORK_ATTACHMENTS_DIR } from './workdir';

const ID = 'an-2';
const OTHER = 'an-1';
const PROJECT = 'AQ';

async function setup() {
  const root = await tempRoot();
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jm-work-'));
  const analysisDir = (id: string) => path.join(root, '.jm', 'analisis', id);
  const copiesDir = (id: string) => path.join(workDir, WORK_ATTACHMENTS_DIR, WORK_ANALYSIS_DIR, id);
  const make = async (id: string) => {
    const store = createAnalysisProjectStore(root, id);
    await createAnalysis(store, id, `Análisis ${id}`, PROJECT);
    await store.writeText('fuentes/nota.md', 'contenido');
    await store.writeText('documentos/propuesta.md', 'propuesta');
    await store.append(CHAT_FILE, '{"role":"user","text":"hola","at":"t"}\n');
    fs.mkdirSync(copiesDir(id), { recursive: true });
    fs.writeFileSync(path.join(copiesDir(id), 'captura.png'), 'png');
    return store;
  };
  return { root, workDir, analysisDir, copiesDir, make };
}

test('borrar un análisis quita su carpeta entera (con subcarpetas) y sus copias, y deja los demás', async () => {
  const { workDir, analysisDir, copiesDir, make } = await setup();
  const store = await make(ID);
  const other = await make(OTHER);
  assert.deepEqual(await removeAnalysis(store, workDir, ID), { ok: true });
  assert.equal(fs.existsSync(analysisDir(ID)), false);
  assert.equal(fs.existsSync(copiesDir(ID)), false);
  assert.equal(await readAnalysis(store, ID), null);
  assert.equal(fs.existsSync(analysisDir(OTHER)), true);
  assert.equal(fs.existsSync(copiesDir(OTHER)), true);
  assert.ok(await readAnalysis(other, OTHER));
});

test('con una tarea de seguimiento en Jira se niega y no borra nada', async () => {
  const { workDir, analysisDir, copiesDir, make } = await setup();
  const store = await make(ID);
  await updateAnalysis(store, ID, (state) => {
    state.trackingTasks.push({ issueKey: 'AQ-160', estimateSeconds: 3600, createdAt: 't' });
  });
  const outcome = await removeAnalysis(store, workDir, ID);
  assert.deepEqual(outcome, { ok: false, message: `${ID} tiene su tarea en Jira (AQ-160); no lo borro.` });
  assert.equal(fs.existsSync(path.join(analysisDir(ID), ANALYSIS_STATE_FILE)), true);
  assert.equal(fs.existsSync(path.join(analysisDir(ID), 'fuentes', 'nota.md')), true);
  assert.equal(fs.existsSync(copiesDir(ID)), true);
});

test('un análisis inexistente no es un éxito', async () => {
  const { workDir, root } = await setup();
  const outcome = await removeAnalysis(createAnalysisProjectStore(root, ID), workDir, ID);
  assert.deepEqual(outcome, { ok: false, message: `El análisis ${ID} no existe.` });
});

test('un análisis nuevo tras borrar el último reutiliza el número pero no hereda nada', async () => {
  const { root, workDir, analysisDir, make } = await setup();
  await make(OTHER);
  const store = await make(ID);
  await updateAnalysis(store, ID, (state) => {
    state.claudeSessionId = '11111111-2222-3333-4444-555555555555';
    state.sources.push({ file: 'nota.md', origin: 'file', addedAt: 't' });
  });
  await removeAnalysis(store, workDir, ID);
  const ids = fs.existsSync(path.dirname(analysisDir(ID))) ? fs.readdirSync(path.dirname(analysisDir(ID))) : [];
  assert.equal(nextAnalysisId(ids), ID);
  const fresh = createAnalysisProjectStore(root, ID);
  const state = await createAnalysis(fresh, ID, 'Otro', PROJECT);
  assert.equal(state.claudeSessionId, null);
  assert.deepEqual(state.sources, []);
  assert.equal(await fresh.readText(CHAT_FILE), null);
  assert.equal(await fresh.exists('fuentes/nota.md'), false);
  assert.equal(await fresh.exists('documentos/propuesta.md'), false);
});

test('las copias del área de trabajo solo se borran dentro de adjuntos/analisis/<id>', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-work-'));
  const base = path.join(workDir, WORK_ATTACHMENTS_DIR, WORK_ANALYSIS_DIR);
  fs.mkdirSync(path.join(base, ID), { recursive: true });
  fs.mkdirSync(path.join(base, OTHER), { recursive: true });
  const historia = path.join(workDir, WORK_ATTACHMENTS_DIR, 'AQ-45');
  fs.mkdirSync(historia, { recursive: true });
  for (const bad of ['..', '../AQ-45', 'an-2/..', '', 'AQ-45']) {
    assert.throws(() => removeAnalysisWorkCopies(workDir, bad), /inválido/, bad);
  }
  assert.doesNotThrow(() => removeAnalysisWorkCopies(workDir, 'an-9'));
  removeAnalysisWorkCopies(workDir, ID);
  assert.equal(fs.existsSync(path.join(base, ID)), false);
  assert.equal(fs.existsSync(path.join(base, OTHER)), true);
  assert.equal(fs.existsSync(historia), true);
});

test('un archivo con nombre que jm no puede borrar frena el borrado antes de tocar nada', async () => {
  const { workDir, analysisDir, copiesDir, make } = await setup();
  const store = await make(ID);
  fs.writeFileSync(path.join(analysisDir(ID), 'fuentes', 'raro%.md'), 'x');
  await assert.rejects(removeAnalysis(store, workDir, ID), /no puede borrar/);
  assert.equal(fs.existsSync(path.join(analysisDir(ID), 'fuentes', 'nota.md')), true);
  assert.equal(fs.existsSync(path.join(analysisDir(ID), ANALYSIS_STATE_FILE)), true);
  // Las copias de trabajo se quitan primero; el análisis sigue visible para reintentar
  assert.equal(fs.existsSync(copiesDir(ID)), false);
});

test('una tarea en Jira mal formada en el estado también impide borrar', async () => {
  const { workDir, analysisDir, make } = await setup();
  const store = await make(ID);
  const file = path.join(analysisDir(ID), ANALYSIS_STATE_FILE);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(file, JSON.stringify({ ...raw, trackingTasks: [{ issueKey: 42 }] }));
  const outcome = await removeAnalysis(store, workDir, ID);
  assert.equal(outcome.ok, false);
  assert.equal(fs.existsSync(file), true);
});
