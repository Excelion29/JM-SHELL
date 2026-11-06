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
import { setSession, setSessionPin, getSession, clearSession } from '../utils/session';
import { writeFileAtomicNoLinks } from '../utils/safe-write';
import { error } from '../utils/format';
import { reclaimStdin } from '../utils/terminal';
import { projectRoot, toSummary } from '../refinement/state';
import {
  BROWSE_LIMIT,
  buildEpicsJql,
  buildStoriesJql,
  filterByProject,
  isValidProjectKey,
  toBrowseItem,
} from '../refinement/browse';
import { BrowseItem, ProjectItem } from '../refinement/types';
import { createChatBridge } from './chat-bridge';
import { createPlanBridge } from './plan-bridge';
import { runRefine } from './refine';
import { closeStoryStores, listAllStories } from './story-resolver';

const BACK_NOTICE = 'Volviste de Claude Code.';

// import() real: el CJS no puede hacer require() de la isla ESM (ink)
const loadTui = () => import('../tui/app.js');

async function readProjectKey(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).projectKey;
  } catch {
    return null; // sin .jira.json: la app muestra "sin proyecto"
  }
}

// Las historias viven en la base conectada o, sin base, en la carpeta donde se abrió jm
async function loadSummaries(projectKey: string | null) {
  try {
    const stories = await listAllStories(projectRoot());
    return filterByProject(stories.map(toSummary), projectKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err: unknown) {
    error(`No pude leer tus historias: ${(err as Error).message}`);
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
  writeFileAtomicNoLinks(
    file,
    `${JSON.stringify(config, null, 2)}
`,
  );
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

// Ink ya está desmontado aquí: claude hereda la terminal completa. El resultado vuelve como aviso para la app
async function handoffAndReturn(key: string): Promise<string> {
  let notice: string;
  try {
    notice = `${BACK_NOTICE} ${await runRefine(key, { inApp: true })}`;
  } catch (err: unknown) {
    notice = (err as Error).message;
  }
  reclaimStdin();
  return notice;
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
  let notice: string | null = null;
  const chat = createChatBridge(sessionJira);
  const plan = createPlanBridge(sessionJira);

  try {
    for (;;) {
      const action = await runApp({
        projectKey,
        stories: await loadSummaries(projectKey),
        loadStories: loadSummaries,
        unlocked,
        chat,
        plan,
        initialChatKey,
        notice,
        fetchEpics: async (): Promise<BrowseItem[]> =>
          (await sessionJira().searchIssues(buildEpicsJql(requireProjectKey(projectKey))))
            .slice(0, BROWSE_LIMIT)
            .map(toBrowseItem),
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
            setSessionPin(pin);
            unlocked = true;
            return { ok: true };
          } catch (err: unknown) {
            return { ok: false, message: (err as Error).message };
          }
        },
      });
      if (!action) break;
      chat.closeNow();
      initialChatKey = action.key;
      notice = await handoffAndReturn(action.key);
    }
  } finally {
    closeStoryStores();
    clearSession();
  }
}
