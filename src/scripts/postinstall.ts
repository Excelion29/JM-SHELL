import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Solo ejecutar en instalaciones globales
if (process.env.npm_config_global !== 'true') process.exit(0);

const VSCODE_SETTINGS_CANDIDATES = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'settings.json'),
  path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
];

const TERMINAL_PROFILE = {
  path: 'powershell.exe',
  args: ['-NoExit', '-Command', 'jdf shell'],
  icon: 'rocket',
  color: 'terminal.ansiCyan',
};

async function configureVSCode(): Promise<boolean> {
  for (const settingsPath of VSCODE_SETTINGS_CANDIDATES) {
    if (!await fs.pathExists(settingsPath)) continue;

    try {
      const raw = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(raw);

      const profiles = settings['terminal.integrated.profiles.windows'] ?? {};
      if (profiles['DevFlow (jdf)']) {
        console.log('  ✓ Perfil de VS Code ya estaba configurado.');
        return true;
      }

      profiles['DevFlow (jdf)'] = TERMINAL_PROFILE;
      settings['terminal.integrated.profiles.windows'] = profiles;

      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
      console.log('  ✓ Perfil "DevFlow (jdf)" agregado al terminal de VS Code.');
      return true;
    } catch {
      // Seguir con el siguiente path
    }
  }
  return false;
}

async function main(): Promise<void> {
  console.log('\n  DevFlow — Configuración automática\n');

  const vsConfigured = await configureVSCode();
  if (!vsConfigured) {
    console.log('  ℹ VS Code no encontrado. Puedes agregar el perfil manualmente.');
  }

  console.log('\n  ─────────────────────────────────────────');
  console.log('  ¡Instalación completa!');
  console.log('  Ejecuta: jdf init    para configurar tus credenciales.');
  console.log('  ─────────────────────────────────────────\n');
}

main().catch(() => {});
