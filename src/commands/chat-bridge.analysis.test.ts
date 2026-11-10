import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { JiraService } from '../services/jira';
import { createAnalysis, readAnalysis, updateAnalysis } from '../refinement/analysis';
import * as claudeModule from '../refinement/claude';
import { CHAT_FILES, workDirFor } from '../refinement/workdir';
import * as refineModule from './refine';
import { createChatBridge, INVALID_POINTS_LABEL } from './chat-bridge';
import { closeStoryStores, openAnalysis } from './story-resolver';

const SESSION = '123e4567-e89b-12d3-a456-426614174000';
const ID = 'an-1';
let root: string;
let previousCwd: string;

before(async () => {
  previousCwd = process.cwd();
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-chatan-')));
  await fs.writeJson(path.join(root, '.jira.json'), { projectKey: 'AQ' });
  process.chdir(root);
});
after(async () => {
  process.chdir(previousCwd);
  closeStoryStores();
  await fs.remove(workDirFor(root));
});

const jiraThatMustNotBeUsed = () => {
  throw new Error('Un análisis no debe tocar Jira');
};

test('abrir el chat de un análisis no toca Jira, usa la skill analizar y pasa a debate', async (t) => {
  t.mock.method(claudeModule, 'isClaudeAvailable', () => true);
  t.mock.method(refineModule, 'ensureSkill', async () => undefined);
  const prepare = t.mock.method(refineModule, 'prepareStory', async () => undefined);
  const store = await openAnalysis(root, ID);
  await createAnalysis(store, ID, 'Observaciones', 'AQ');
  // Con sesión guardada la conversación queda esperando al dev: no se lanza claude
  await updateAnalysis(store, ID, (s) => {
    s.claudeSessionId = SESSION;
  });
  const bridge = createChatBridge(jiraThatMustNotBeUsed as unknown as () => JiraService);
  const opened = await bridge.open(ID, () => undefined);
  assert.equal(prepare.mock.callCount(), 0);
  assert.equal(opened.idle, true);
  assert.equal(opened.header.kind, 'analysis');
  assert.equal(opened.header.key, ID);
  assert.equal(opened.header.phase, 'debate');
  assert.equal(opened.header.phaseLabel, 'debate');
  const skill = await fs.readFile(path.join(workDirFor(root), CHAT_FILES.analysisSkill), 'utf8');
  assert.match(skill, /^---\r?\nname: analizar/);
  assert.equal((await readAnalysis(store, ID))?.phase, 'debate');
  await bridge.close();
});

test('referenciar una nota inválida se rechaza y no toca el estado', async (t) => {
  t.mock.method(claudeModule, 'isClaudeAvailable', () => true);
  t.mock.method(refineModule, 'ensureSkill', async () => undefined);
  const bridge = createChatBridge(jiraThatMustNotBeUsed as unknown as () => JiraService);
  await bridge.open(ID, () => undefined);
  await assert.rejects(() => bridge.referenceNotes(['../secreto.md']), /no válida/);
  const store = await openAnalysis(root, ID);
  assert.equal((await readAnalysis(store, ID))?.referencedNotes, undefined);
  await bridge.close();
});

test('un id que no es de análisis ni clave de Jira se rechaza antes de tocar nada', async () => {
  const bridge = createChatBridge(jiraThatMustNotBeUsed as unknown as () => JiraService);
  await assert.rejects(() => bridge.open('an-1/../x', () => undefined), /inválida/);
});

const VALID_POINT = {
  id: 'P1',
  title: 'Guardia',
  analysis: 'a',
  proposal: 'p',
  outOfScope: false,
  estimate: { optimistic: '30m', likely: '1h', pessimistic: '2h' },
  risk: 'low',
};

test('el encabezado muestra puntos.json con errores si el archivo no valida', async (t) => {
  t.mock.method(claudeModule, 'isClaudeAvailable', () => true);
  t.mock.method(refineModule, 'ensureSkill', async () => undefined);
  const store = await openAnalysis(root, ID);
  await store.writeText('puntos.json', '{ roto');
  const bridge = createChatBridge(jiraThatMustNotBeUsed as unknown as () => JiraService);
  const opened = await bridge.open(ID, () => undefined);
  assert.equal(opened.header.detail, INVALID_POINTS_LABEL);
  await bridge.close();
});

test('con puntos válidos y fase.json documentado el encabezado muestra la cuenta y "documentado"', async (t) => {
  t.mock.method(claudeModule, 'isClaudeAvailable', () => true);
  t.mock.method(refineModule, 'ensureSkill', async () => undefined);
  const store = await openAnalysis(root, ID);
  await store.writeText('puntos.json', JSON.stringify({ points: [VALID_POINT] }));
  await store.writeText('fase.json', JSON.stringify({ phase: 'documented', block: null }));
  const bridge = createChatBridge(jiraThatMustNotBeUsed as unknown as () => JiraService);
  const opened = await bridge.open(ID, () => undefined);
  assert.equal(opened.header.phaseLabel, 'documentado');
  assert.equal(opened.header.phase, 'documented');
  assert.match(opened.header.detail ?? '', /^1 punto · .+ esperadas$/);
  await bridge.close();
});
