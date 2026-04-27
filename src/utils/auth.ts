import inquirer from 'inquirer';
import { loadGlobalConfig, globalConfigExists } from '../config/loader';
import { GlobalConfig } from '../config/types';
import { getSession, setSession } from './session';
import { error } from './format';

export async function requireAuth(): Promise<GlobalConfig> {
  // Reusar sesión activa (modo shell)
  const session = getSession();
  if (session) return session;

  const configured = await globalConfigExists();
  if (!configured) {
    error('No inicializado. Ejecuta `jdf init` primero.');
    process.exit(1);
  }

  const { pin } = await inquirer.prompt([
    {
      type: 'password',
      name: 'pin',
      message: 'PIN:',
      mask: '*',
      validate: (val: string) => val.length >= 4 ? true : 'El PIN debe tener al menos 4 caracteres',
    },
  ]);

  let config: GlobalConfig;
  try {
    config = await loadGlobalConfig(pin);
  } catch (err: unknown) {
    error((err as Error).message);
    process.exit(1);
  }

  return config;
}
