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
import { BrowseItem, ProjectItem, StorySummary } from '../refinement/types';
import { analysisSummary, filterAnalysesByProject } from '../refinement/analysis';
import { createAnalysisBridge } from './analysis-bridge';
import { createChatBridge } from './chat-bridge';
import { createManagementBridge } from './management-bridge';
import type { PointFinishTarget } from '../refinement/analysis-types';
import type { TaskFinishTarget } from '../refinement/tasks-types';
import { runTaskSession } from './execute';
import { runPointSession } from './execute-point';
import { createPlanBridge } from './plan-bridge';
import { createTasksBridge } from './tasks-bridge';
import { runRefine } from './refine';
import { closeStoryStores, listAllAnalyses, listAllStories } from './story-resolver';

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

async function loadStorySummaries(projectKey: string | null): Promise<StorySummary[]> {
  try {
    const stories = await listAllStories(projectRoot());
    return filterByProject(stories.map(toSummary), projectKey);
  } catch (err: unknown) {
    error(`No pude leer tus historias: ${(err as Error).message}`);
    return [];
  }
}

// Un fallo al leer los análisis no debe esconder las historias
async function loadAnalysisSummaries(projectKey: string | null): Promise<StorySummary[]> {
  try {
    return filterAnalysesByProject(await listAllAnalyses(projectRoot()), projectKey).map(analysisSummary);
  } catch (err: unknown) {
    error(`No pude leer tus análisis: ${(err as Error).message}`);
    return [];
  }
}

// Las historias y los análisis sin historia viven en la base conectada o, sin base, en la carpeta donde se abrió jm
async function loadSummaries(projectKey: string | null): Promise<StorySummary[]> {
  const [stories, analyses] = await Promise.all([loadStorySummaries(projectKey), loadAnalysisSummaries(projectKey)]);
  return [...stories, ...analyses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

// Ink ya está desmontado aquí; si Claude se abrió, al volver la app pregunta si la tarea se terminó
async function runTaskAndReturn(
  storyKey: string | null,
  issueKey: string,
): Promise<{ notice: string; finish: TaskFinishTarget | null }> {
  let result: { notice: string; finish: TaskFinishTarget | null };
  try {
    await runTaskSession(sessionJira(), storyKey, issueKey);
    result = { notice: BACK_NOTICE, finish: { storyKey, issueKey } };
  } catch (err: unknown) {
    result = { notice: (err as Error).message, finish: null };
  }
  reclaimStdin();
  return result;
}

// Ink ya está desmontado aquí; al volver, la pantalla de puntos pregunta si el punto se terminó
async function runPointAndReturn(
  analysisId: string,
  pointId: string,
): Promise<{ notice: string; finish: PointFinishTarget | null }> {
  let result: { notice: string; finish: PointFinishTarget | null };
  try {
    await runPointSession(analysisId, pointId);
    result = { notice: BACK_NOTICE, finish: { analysisId, pointId } };
  } catch (err: unknown) {
    result = { notice: (err as Error).message, finish: null };
  }
  reclaimStdin();
  return result;
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
  const tasks = createTasksBridge(sessionJira);
  const management = createManagementBridge(sessionJira);
  const analysis = createAnalysisBridge(sessionJira, () => projectKey);
  let initialTaskFinish: TaskFinishTarget | null = null;
  let initialPointFinish: PointFinishTarget | null = null;

  try {
    for (;;) {
      const action = await runApp({
        projectKey,
        stories: await loadSummaries(projectKey),
        loadStories: loadSummaries,
        unlocked,
        chat,
        plan,
        tasks,
        management,
        analysis,
        initialTaskFinish,
        initialPointFinish,
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
      initialTaskFinish = null;
      initialPointFinish = null;
      if (action.type === 'runPoint') {
        initialChatKey = null;
        const outcome = await runPointAndReturn(action.analysisId, action.pointId);
        notice = outcome.notice;
        initialPointFinish = outcome.finish;
      } else if (action.type === 'runTask') {
        initialChatKey = null;
        const outcome = await runTaskAndReturn(action.storyKey, action.issueKey);
        notice = outcome.notice;
        initialTaskFinish = outcome.finish;
      } else {
        initialChatKey = action.key;
        notice = await handoffAndReturn(action.key);
      }
    }
  } finally {
    closeStoryStores();
    clearSession();
  }
}
