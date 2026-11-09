import openBrowser from 'open';
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
import type { EstimateFactors } from '../refinement/calibration';
import type { PlanBridge } from '../refinement/review-types';
import { projectKeyOfStory } from '../refinement/repos';
import { projectRoot } from '../refinement/state';
import type { StoryStore } from '../refinement/story-store';
import { workDirFor } from '../refinement/workdir';
import { configuredAssignee } from './assignee';
import { loadEstimateFactors } from './calibration-loader';
import { refreshDashboard } from './dashboard';
import { openStory } from './story-resolver';

// Dónde vive la historia (base o .jm): lo decide el resolvedor y se reutiliza durante la sesión
const storeOf = (key: string): Promise<StoryStore> => openStory(projectRoot(), key).then((access) => access.store);

export function createPlanBridge(getJira: () => JiraService): PlanBridge {
  // El historial se lee al abrir la revisión y se reutiliza en cada cambio (no cambia mientras se revisa)
  let factors: Promise<EstimateFactors> | null = null;
  const history = (): Promise<EstimateFactors> => (factors ??= loadEstimateFactors());
  return {
    load: async (key) => {
      factors = loadEstimateFactors();
      return loadReview(await storeOf(key), key, undefined, await factors);
    },
    previewEstimate,
    updateTask: async (key, taskId, patch) =>
      updateTask(await storeOf(key), key, taskId, patch, undefined, await history()),
    setAttachmentPurpose: async (key, file, purpose) =>
      setAttachmentPurpose(await storeOf(key), key, file, purpose, await history()),
    toggleAttachmentTask: async (key, file, taskId) =>
      toggleAttachmentTask(await storeOf(key), key, file, taskId, await history()),
    openAttachment: async (key, file) => {
      assertSafeToOpen(file);
      const workDir = workDirFor(projectRoot());
      await openBrowser(await attachmentFilePath(await storeOf(key), key, file, workDir));
    },
    prepareCreate: async (key) => {
      const jira = getJira();
      const assignee = await defaultAssignee(jira, projectKeyOfStory(key), await configuredAssignee());
      return buildPreview(jira, await storeOf(key), key, assignee);
    },
    resolveTarget: (parentKey) => resolveTarget(getJira(), parentKey),
    findExisting: async (key, target) => findExistingMatches(getJira(), await storeOf(key), key, target),
    listAssignees: (key) => listAssignees(getJira(), projectKeyOfStory(key)),
    create: async (key, request, onProgress) => {
      const outcome = await runCreation({ jira: getJira(), store: await storeOf(key) }, key, request, onProgress);
      if (outcome.ok) await refreshDashboard(projectRoot());
      return outcome;
    },
    openInBrowser: async (issueKey) => {
      await openBrowser(getJira().getBrowseUrl(issueKey));
    },
    prepareClose: async (key) => prepareClose(getJira(), await storeOf(key), key),
    close: async (key, files) => {
      const result = await executeClose(getJira(), await storeOf(key), key, files);
      await refreshDashboard(projectRoot());
      return result;
    },
  };
}
