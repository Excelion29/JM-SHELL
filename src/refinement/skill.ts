import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

const SKILL_NAME = 'refinar';
const SKILL_FILE = 'SKILL.md';

export type SkillInstallResult = 'installed' | 'updated' | 'current' | 'missing-asset';

// Desde dist/refinement o dist/scripts: dos niveles hasta la raíz del paquete
export const bundledSkillPath = () => path.join(__dirname, '..', '..', 'assets', 'skills', SKILL_NAME, SKILL_FILE);

export const installedSkillPath = (home: string = os.homedir()) =>
  path.join(home, '.claude', 'skills', SKILL_NAME, SKILL_FILE);

export async function installSkill(
  source: string = bundledSkillPath(),
  target: string = installedSkillPath(),
): Promise<SkillInstallResult> {
  if (!(await fs.pathExists(source))) return 'missing-asset';
  const content = await fs.readFile(source, 'utf8');
  const exists = await fs.pathExists(target);
  if (exists && (await fs.readFile(target, 'utf8')) === content) return 'current';
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, content, 'utf8');
  return exists ? 'updated' : 'installed';
}
