import { globalConfigExists, loadGlobalConfig, loadProjectConfig } from '../config/loader';
import { setSession, clearSession } from '../utils/session';
import { error } from '../utils/format';

// import() real: el CJS no puede hacer require() de la isla ESM (ink)
const loadTui = () => import('../tui/app.js');

async function readProjectKey(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).projectKey;
  } catch {
    return null; // sin .jira.json: la app muestra "sin proyecto"
  }
}

export async function appCommand(): Promise<void> {
  if (!(await globalConfigExists())) {
    error('No inicializado. Ejecuta `jdf init` primero.');
    process.exit(1);
  }

  const { runApp } = await loadTui();

  try {
    await runApp({
      projectKey: await readProjectKey(),
      unlock: async (pin) => {
        try {
          setSession(await loadGlobalConfig(pin));
          return { ok: true };
        } catch (err: unknown) {
          return { ok: false, message: (err as Error).message };
        }
      },
    });
  } finally {
    clearSession();
  }
}
