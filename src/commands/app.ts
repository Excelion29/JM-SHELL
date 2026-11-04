import * as readline from 'readline';
import * as fs from 'fs-extra';
import * as path from 'path';
import {
  findFileUpward,
  globalConfigExists,
  loadGlobalConfig,
  loadProjectConfig,
  PROJECT_CONFIG_NAME,
} from '../config/loader';
import { ProjectConfig } from '../config/types';
import { JiraService } from '../services/jira';
import { setSession, getSession, clearSession } from '../utils/session';
import { writeFileAtomicNoLinks } from '../utils/safe-write';
import { error, warn } from '../utils/format';
import { listStories, projectRoot, toSummary } from '../refinement/state';
import { BROWSE_LIMIT, buildEpicsJql, buildStoriesJql, filterByProject, isValidProjectKey, toBrowseItem } from '../refinement/browse';
import { BrowseItem, ProjectItem } from '../refinement/types';
import { mappedRoot, noCodeRootPath } from '../refinement/repos';
import { createChatBridge } from './chat-bridge';
import { runRefine } from './refine';

// import() real: el CJS no puede hacer require() de la isla ESM (ink)
const loadTui = () => import('../tui/app.js');

const BACK_PROMPT = '\nPulsa Enter para volver a JM-SHELL...';

async function readProjectKey(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).projectKey;
  } catch {
    return null; // sin .jira.json: la app muestra "sin proyecto"
  }
}

// Un repos.json dañado no debe tumbar el inicio: se avisa y se usa la carpeta actual
function codeRootFor(projectKey: string): string {
  try {
    return mappedRoot(projectKey) ?? projectRoot();
  } catch (err: unknown) {
    warn(`No pude leer ~/.jira-tool/repos.json (${(err as Error).message}). Uso la carpeta actual.`);
    return projectRoot();
  }
}

// Las historias viven en la carpeta de código del proyecto o, sin código, en la carpeta propia de jm
async function loadSummaries(projectKey: string | null) {
  try {
    const roots = projectKey
      ? [...new Set([codeRootFor(projectKey), noCodeRootPath(projectKey)])]
      : [projectRoot()];
    const stories = (await Promise.all(roots.map((root) => listStories(root)))).flat();
    return filterByProject(stories.map(toSummary), projectKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err: unknown) {
    error(`No pude leer tus historias de .jm: ${(err as Error).message}`);
    return [];
  }
}

function sessionJira(): JiraService {
  const session = getSession();
  if (!session) throw new Error('La sesión no está abierta. Reinicia jm e ingresa tu PIN.');
  return new JiraService(session);
}

function requireProjectKey(projectKey: string | null): string {
  if (!projectKey) throw new Error('Aún no hay un proyecto elegido. Pulsa p para elegir uno.');
  return projectKey;
}

function writeProjectConfig(file: string, config: ProjectConfig): void {
  writeFileAtomicNoLinks(file, `${JSON.stringify(config, null, 2)}
`);
}

// Con .jira.json existente solo cambia projectKey; sin él, se crea en el directorio actual
async function persistProjectKey(jira: JiraService, key: string): Promise<void> {
  const existing = findFileUpward(PROJECT_CONFIG_NAME);
  if (existing) {
    const config = (await fs.readJson(existing)) as ProjectConfig;
    writeProjectConfig(existing, { ...config, projectKey: key });
    return;
  }
  const me = await jira.getMyself();
  writeProjectConfig(path.join(process.cwd(), PROJECT_CONFIG_NAME), { projectKey: key, defaultAssignee: me.accountId });
}

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(BACK_PROMPT, () => (rl.close(), resolve())));
}

// Ink ya está desmontado aquí: claude hereda la terminal completa
async function handoffAndReturn(key: string): Promise<void> {
  try {
    await runRefine(key);
  } catch (err: unknown) {
    error((err as Error).message);
  }
  await waitForEnter();
}

export interface AppOptions {
  chatKey?: string;
}

export async function appCommand(options: AppOptions = {}): Promise<void> {
  if (!(await globalConfigExists())) {
    error('No inicializado. Ejecuta `jm init` primero.');
    process.exit(1);
  }

  const { runApp } = await loadTui();
  let projectKey = await readProjectKey();
  let unlocked = false;
  let initialChatKey = options.chatKey ?? null;
  const chat = createChatBridge(sessionJira);

  try {
    for (;;) {
      const action = await runApp({
        projectKey,
        stories: await loadSummaries(projectKey),
        loadStories: loadSummaries,
        unlocked,
        chat,
        initialChatKey,
        fetchEpics: async (): Promise<BrowseItem[]> =>
          (await sessionJira().searchIssues(buildEpicsJql(requireProjectKey(projectKey)))).slice(0, BROWSE_LIMIT).map(toBrowseItem),
        fetchStories: async (epicKey): Promise<BrowseItem[]> =>
          (await sessionJira().searchIssues(buildStoriesJql(requireProjectKey(projectKey), epicKey)))
            .slice(0, BROWSE_LIMIT)
            .map(toBrowseItem),
        fetchProjects: async (): Promise<ProjectItem[]> =>
          (await sessionJira().getProjects()).map(({ key, name }) => ({ key, name })),
        setProject: async (key) => {
          try {
            if (!isValidProjectKey(key)) throw new Error(`La clave de proyecto "${key}" no es válida.`);
            await persistProjectKey(sessionJira(), key);
            projectKey = key;
            return { ok: true };
          } catch (err: unknown) {
            return { ok: false, message: (err as Error).message };
          }
        },
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
      initialChatKey = null;
      if (!action) break;
      chat.closeNow();
      await handoffAndReturn(action.key);
    }
  } finally {
    clearSession();
  }
}
