import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { JiraService } from '../services/jira';
import * as sourcesModule from '../refinement/analysis-sources';
import { createAnalysisBridge } from './analysis-bridge';
import { loadCalibration } from './calibration-loader';
import { closeStoryStores, invalidateAnalysisListing, listAllAnalyses } from './story-resolver';

let root: string;
let previousCwd: string;

before(async () => {
  previousCwd = process.cwd();
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-abridge-')));
  await fs.writeJson(path.join(root, '.jira.json'), { projectKey: 'AQ', defaultAssignee: 'x' });
  process.chdir(root);
});
after(() => {
  process.chdir(previousCwd);
  closeStoryStores();
});

const bridge = () => createAnalysisBridge(() => ({}) as JiraService, () => 'AQ');

test('si falla la copia de fuentes el análisis queda creado: ok con su id y el error como resultado', async (t) => {
  const failing = t.mock.method(sourcesModule, 'addSources', async () => {
    throw new Error('disco lleno');
  });
  const outcome = await bridge().create({ name: 'Con fallo', paths: '', text: 'algo' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.id, 'an-1');
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].ok, false);
  assert.match(outcome.results[0].ok ? '' : outcome.results[0].message, /disco lleno/);
  assert.equal(failing.mock.callCount(), 1);
  invalidateAnalysisListing(root);
  assert.deepEqual((await listAllAnalyses(root)).map((a) => a.name), ['Con fallo']);
  // Reintentar crea el siguiente, nunca pisa el anterior
  t.mock.restoreAll();
  const second = await bridge().create({ name: 'Otro', paths: '', text: '' });
  assert.equal(second.ok && second.id, 'an-2');
});

test('la calibración cuenta los análisis ilegibles en vez de ocultarlos', async () => {
  const broken = path.join(root, '.jm', 'analisis', 'an-9');
  await fs.ensureDir(broken);
  await fs.writeFile(path.join(broken, 'estado.json'), '{ roto');
  invalidateAnalysisListing(root);
  const model = await loadCalibration();
  assert.equal(model.unreadable, 1);
});
