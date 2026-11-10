import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { installedSkillPath, installSkills, SKILL_NAMES } from './skill';

test('instala las skills refinar, ejecutar y analizar y no las reescribe si ya están al día', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-skills-'));
  const first = await installSkills(home);
  assert.deepEqual(first, { refinar: 'installed', ejecutar: 'installed', analizar: 'installed' });
  for (const name of SKILL_NAMES) assert.ok(await fs.pathExists(installedSkillPath(home, name)));
  assert.deepEqual(await installSkills(home), { refinar: 'current', ejecutar: 'current', analizar: 'current' });
});

test('la skill ejecutar no menciona herramientas ajenas al producto instalado', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-skills-'));
  await installSkills(home);
  const text = await fs.readFile(installedSkillPath(home, 'ejecutar'), 'utf8');
  assert.doesNotMatch(text, /talos/i);
});
