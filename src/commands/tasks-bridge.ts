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
import { createFileTransitionMemory } from '../refinement/transition-memory';
import { isValidIssueKey, projectRoot } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import type { TasksBridge } from '../refinement/tasks-types';
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
    openInBrowser: async (issueKey) => {
      await openBrowser(getJira().getBrowseUrl(issueKey));
    },
  };
}
