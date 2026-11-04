import * as readline from 'readline';
import { globalConfigExists, loadGlobalConfig, loadProjectConfig } from '../config/loader';
import { setSession, clearSession } from '../utils/session';
import { error } from '../utils/format';
import { listStories, projectRoot, toSummary } from '../refinement/state';
import { runRefine } from './refine';

// import() real: el CJS no puede hacer require() de la isla ESM (ink)
const loadTui = () => import('../tui/app.js');

const BACK_PROMPT = '\nPulsa Enter para volver a DevFlow...';

async function readProjectKey(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).projectKey;
  } catch {
    return null; // sin .jira.json: la app muestra "sin proyecto"
  }
}

async function loadSummaries() {
  try {
    return (await listStories(projectRoot())).map(toSummary);
  } catch (err: unknown) {
    error(`No pude leer tus historias de .jdf: ${(err as Error).message}`);
    return [];
  }
}

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(BACK_PROMPT, () => (rl.close(), resolve())));
}

// Ink ya está desmontado aquí: claude hereda la terminal completa
async function refineAndReturn(key: string): Promise<void> {
  try {
    await runRefine(key);
  } catch (err: unknown) {
    error((err as Error).message);
  }
  await waitForEnter();
}

export async function appCommand(): Promise<void> {
  if (!(await globalConfigExists())) {
    error('No inicializado. Ejecuta `jdf init` primero.');
    process.exit(1);
  }

  const { runApp } = await loadTui();
  const projectKey = await readProjectKey();
  let unlocked = false;

  try {
    for (;;) {
      const action = await runApp({
        projectKey,
        stories: await loadSummaries(),
        unlocked,
        unlock: async (pin) => {
          try {
            setSession(await loadGlobalConfig(pin));
            unlocked = true;
            return { ok: true };
          } catch (err: unknown) {
            return { ok: false, message: (err as Error).message };
          }
        },
      });
      if (!action) break;
      await refineAndReturn(action.key);
    }
  } finally {
    clearSession();
  }
}
