import openBrowser from 'open';
import { loadProjectConfig } from '../config/loader';
import { JiraService } from '../services/jira';
import { executeClose, prepareClose } from '../refinement/close';
import {
  buildPreview,
  defaultAssignee,
  findExistingMatches,
  listAssignees,
  resolveTarget,
  runCreation,
} from '../refinement/create';
import {
  assertSafeToOpen,
  attachmentFilePath,
  loadReview,
  previewEstimate,
  setAttachmentPurpose,
  toggleAttachmentTask,
  updateTask,
} from '../refinement/review';
import type { PlanBridge } from '../refinement/review-types';
import { projectKeyOfStory } from '../refinement/repos';
import { storyRootFor } from '../refinement/story-root';

export async function configuredAssignee(): Promise<string | null> {
  try {
    return (await loadProjectConfig()).defaultAssignee || null;
  } catch {
    return null; // sin .jira.json se usa al usuario actual
  }
}

export function createPlanBridge(getJira: () => JiraService): PlanBridge {
  return {
    load: (key) => loadReview(storyRootFor(key), key),
    previewEstimate,
    updateTask: (key, taskId, patch) => updateTask(storyRootFor(key), key, taskId, patch),
    setAttachmentPurpose: (key, file, purpose) => setAttachmentPurpose(storyRootFor(key), key, file, purpose),
    toggleAttachmentTask: (key, file, taskId) => toggleAttachmentTask(storyRootFor(key), key, file, taskId),
    openAttachment: async (key, file) => {
      assertSafeToOpen(file);
      await openBrowser(attachmentFilePath(storyRootFor(key), key, file));
    },
    prepareCreate: async (key) => {
      const jira = getJira();
      const assignee = await defaultAssignee(jira, projectKeyOfStory(key), await configuredAssignee());
      return buildPreview(jira, storyRootFor(key), key, assignee);
    },
    resolveTarget: (parentKey) => resolveTarget(getJira(), parentKey),
    findExisting: (key, target) => findExistingMatches(getJira(), storyRootFor(key), key, target),
    listAssignees: (key) => listAssignees(getJira(), projectKeyOfStory(key)),
    create: (key, request, onProgress) =>
      runCreation({ jira: getJira(), root: storyRootFor(key) }, key, request, onProgress),
    openInBrowser: async (issueKey) => {
      await openBrowser(getJira().getBrowseUrl(issueKey));
    },
    prepareClose: (key) => prepareClose(getJira(), storyRootFor(key), key),
    close: (key, files) => executeClose(getJira(), storyRootFor(key), key, files),
  };
}
