import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

export const SKILL_NAMES = ['refinar', 'ejecutar', 'analizar'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];
const SKILL_FILE = 'SKILL.md';

export type SkillInstallResult = 'installed' | 'updated' | 'current' | 'missing-asset';

// Desde dist/refinement o dist/scripts: dos niveles hasta la raíz del paquete
export const bundledSkillPath = (name: SkillName = 'refinar') =>
  path.join(__dirname, '..', '..', 'assets', 'skills', name, SKILL_FILE);

export const installedSkillPath = (home: string = os.homedir(), name: SkillName = 'refinar') =>
  path.join(home, '.claude', 'skills', name, SKILL_FILE);

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

// Instala todas las skills del paquete; el resultado va por nombre
export async function installSkills(
  home: string = os.homedir(),
  sourceOf: (name: SkillName) => string = bundledSkillPath,
): Promise<Record<SkillName, SkillInstallResult>> {
  const results = {} as Record<SkillName, SkillInstallResult>;
  for (const name of SKILL_NAMES) results[name] = await installSkill(sourceOf(name), installedSkillPath(home, name));
  return results;
}
