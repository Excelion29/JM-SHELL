import openBrowser from 'open';
import { JiraService } from '../services/jira';
import {
  deleteTasks,
  finishTask,
  loadMyDay,
  loadTaskRows,
  retryPending,
  returnOptions,
  returnTo,
  startTask,
} from '../refinement/execution';
import { defaultAssignee } from '../refinement/create';
import { createPlanning, openPlanningOf, planningFailure } from '../refinement/planning';
import { projectKeyOfStory } from '../refinement/repos';
import { isValidIssueKey, projectRoot, readState } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import type { PlanningInput, PlanningOutcome, TasksBridge } from '../refinement/tasks-types';
import { createFileTransitionMemory } from '../refinement/transition-memory';
import { configuredAssignee } from './assignee';
import { readManagement } from './management-store';
import { loadCalibration, loadPlanningSuggestion } from './calibration-loader';
import { openStory, listAllStories } from './story-resolver';

const NO_ASSIGNEE = 'No encontré a quién asignarla en el proyecto.';

const storeOf = (key: string): Promise<StoryStore> => openStory(projectRoot(), key).then((access) => access.store);

// La tarea de "Mi día" sigue el flujo de la historia solo si esa historia ya vive en jm
async function localStoryOf(parentKey: string | null): Promise<string | null> {
  if (!parentKey || !isValidIssueKey(parentKey)) return null;
  try {
    return (await listAllStories(projectRoot())).some((s) => s.key === parentKey) ? parentKey : null;
  } catch {
    return null; // sin poder listar historias, la tarea se trata como suelta
  }
}

// El responsable de siempre: el configurado en .jira.json o el primero asignable del proyecto
async function planningAssignee(jira: JiraService, storyKey: string): Promise<string> {
  const assignee = await defaultAssignee(jira, projectKeyOfStory(storyKey), await configuredAssignee());
  if (!assignee) throw new Error(NO_ASSIGNEE);
  return assignee.accountId;
}

// La gestión del proyecto de la historia: si está leída pero ilegible, se trata como sin gestión
async function managementKeyOf(storyKey: string): Promise<string | null> {
  const status = await readManagement(projectRoot(), projectKeyOfStory(storyKey)).catch(() => null);
  return typeof status === 'object' && status ? status.key : null;
}

async function startPlanning(
  jira: JiraService,
  transitionMemory: ReturnType<typeof createFileTransitionMemory>,
  storyKey: string,
  input: PlanningInput,
): Promise<PlanningOutcome> {
  try {
    const store = await storeOf(storyKey);
    const assigneeId = await planningAssignee(jira, storyKey);
    const management = await managementKeyOf(storyKey);
    return await createPlanning({ jira, store, assigneeId, transitionMemory, management }, storyKey, input);
  } catch (err: unknown) {
    return { ok: false, message: planningFailure((err as Error).message) };
  }
}

export function createTasksBridge(getJira: () => JiraService): TasksBridge {
  const transitionMemory = createFileTransitionMemory();
  const ctxOf = async (storyKey: string | null) => ({
    jira: getJira(),
    store: storyKey ? await storeOf(storyKey) : null,
    transitionMemory,
  });
  return {
    load: async (storyKey) => loadTaskRows(await ctxOf(storyKey), storyKey),
    start: async (storyKey, issueKey, options) => startTask(await ctxOf(storyKey), storyKey, issueKey, options),
    startMyDay: async (issueKey, parentKey, options) => {
      const storyKey = await localStoryOf(parentKey);
      return startTask(await ctxOf(storyKey), storyKey, issueKey, options);
    },
    finish: async ({ storyKey, issueKey }, options) => finishTask(await ctxOf(storyKey), storyKey, issueKey, options),
    finishMyDay: async (issueKey, parentKey, options) => {
      const storyKey = await localStoryOf(parentKey);
      return finishTask(await ctxOf(storyKey), storyKey, issueKey, options);
    },
    retryPending: async (storyKey) => retryPending(await ctxOf(storyKey), storyKey),
    returnOptions: (issueKey) => returnOptions(getJira(), issueKey),
    returnTo: (issueKey, name) => returnTo(getJira(), issueKey, name),
    remove: async (storyKey, keys) => deleteTasks(await ctxOf(storyKey), storyKey, keys),
    myDay: () => loadMyDay(getJira()),
    calibration: () => loadCalibration(),
    planningStatus: async (storyKey) => ({
      open: openPlanningOf(await readState(await storeOf(storyKey), storyKey)),
      managementKey: await managementKeyOf(storyKey),
    }),
    planningSuggestion: () => loadPlanningSuggestion(),
    createPlanning: (storyKey, input) => startPlanning(getJira(), transitionMemory, storyKey, input),
    openInBrowser: async (issueKey) => {
      await openBrowser(getJira().getBrowseUrl(issueKey));
    },
  };
}
