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
import { calibrate, measuresOf, type StoryMeasures } from '../refinement/calibration';
import { loadPlan } from '../refinement/plan';
import { createFileTransitionMemory } from '../refinement/transition-memory';
import { isValidIssueKey, projectRoot } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import type { CalibrationModel, TasksBridge } from '../refinement/tasks-types';
import { openStory, listAllStories } from './story-resolver';

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

// Todas las historias de esta carpeta; una que no se pueda leer se cuenta aparte y no frena el resto
async function loadCalibration(now: Date = new Date()): Promise<CalibrationModel> {
  const root = projectRoot();
  const stories = await listAllStories(root);
  const measured: StoryMeasures[] = [];
  let unreadable = 0;
  for (const state of stories) {
    try {
      const { store } = await openStory(root, state.key);
      const plan = await loadPlan(store).catch(() => null);
      measured.push(measuresOf(state, plan, now));
    } catch {
      unreadable += 1;
    }
  }
  return calibrate(measured, unreadable);
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
    openInBrowser: async (issueKey) => {
      await openBrowser(getJira().getBrowseUrl(issueKey));
    },
  };
}
