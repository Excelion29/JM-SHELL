import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { installSkill } from '../refinement/skill';

// Solo ejecutar en instalaciones globales
if (process.env.npm_config_global !== 'true') process.exit(0);

const VSCODE_SETTINGS_CANDIDATES = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'settings.json'),
  path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
];

const LEGACY_PROFILE_NAME = 'DevFlow (jdf)';
const PROFILE_NAME = 'JM-SHELL (jm)';

const TERMINAL_PROFILE = {
  path: 'powershell.exe',
  args: ['-NoExit', '-Command', 'jm'],
  icon: 'rocket',
  color: 'terminal.ansiCyan',
};

async function configureVSCode(): Promise<boolean> {
  for (const settingsPath of VSCODE_SETTINGS_CANDIDATES) {
    if (!(await fs.pathExists(settingsPath))) continue;

    try {
      const raw = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(raw);

      const profiles = settings['terminal.integrated.profiles.windows'] ?? {};
      delete profiles[LEGACY_PROFILE_NAME];
      profiles[PROFILE_NAME] = TERMINAL_PROFILE;
      settings['terminal.integrated.profiles.windows'] = profiles;

      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
      console.log(`  ✓ Perfil "${PROFILE_NAME}" agregado al terminal de VS Code.`);
      return true;
    } catch {
      // Seguir con el siguiente path
    }
  }
  return false;
}

async function configureSkill(): Promise<void> {
  try {
    const result = await installSkill();
    if (result === 'missing-asset') console.log('  ℹ No encontré la skill /refinar en el paquete.');
    else console.log('  ✓ Skill /refinar lista en ~/.claude/skills.');
  } catch (err: unknown) {
    console.log(`  ℹ No pude instalar la skill /refinar: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log('\n  JM-SHELL — Configuración automática\n');
  await configureSkill();

  const vsConfigured = await configureVSCode();
  if (!vsConfigured) {
    console.log('  ℹ VS Code no encontrado. Puedes agregar el perfil manualmente.');
  }

  console.log('\n  ─────────────────────────────────────────');
  console.log('  ¡Instalación completa!');
  console.log('  Ejecuta: jm init    para configurar tus credenciales.');
  console.log('  ─────────────────────────────────────────\n');
}

main().catch(() => {});
