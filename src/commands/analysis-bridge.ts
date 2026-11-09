import type { JiraService } from '../services/jira';
import {
  cleanAnalysisName,
  createAnalysis,
  nextAnalysisId,
  openTrackingOf,
  readAnalysis,
} from '../refinement/analysis';
import type { AnalysisBridge, AnalysisState, SourceResult } from '../refinement/analysis-types';
import { addSources } from '../refinement/analysis-sources';
import { createAnalysisTracking, finishAnalysisTask } from '../refinement/analysis-tracking';
import type { TransitionOptions, TransitionOutcome } from '../refinement/tasks-types';
import { createFileTransitionMemory, type TransitionMemory } from '../refinement/transition-memory';
import { projectRoot } from '../refinement/state';
import { projectAssigneeId } from './assignee';
import { loadPlanningSuggestion } from './calibration-loader';
import { readManagementKey } from './management-store';
import { invalidateAnalysisListing, listAnalysisIds, openAnalysis } from './story-resolver';

const SOURCES_FAILURE_LABEL = 'fuentes';
const NO_PROJECT = 'Aún no hay un proyecto elegido. Pulsa p para elegir uno.';

const messageOf = (err: unknown): string => (err as Error).message;

async function stateOf(id: string): Promise<AnalysisState> {
  const state = await readAnalysis(await openAnalysis(projectRoot(), id), id);
  if (!state) throw new Error(`El análisis ${id} no existe.`);
  return state;
}

// Al volver de trabajar: ¿terminaste? Finaliza en Jira y lo registra en el análisis
export async function finishAnalysisTracking(
  jira: JiraService,
  transitionMemory: TransitionMemory,
  id: string,
  issueKey: string,
  options: TransitionOptions,
): Promise<TransitionOutcome> {
  try {
    const store = await openAnalysis(projectRoot(), id);
    const outcome = await finishAnalysisTask({ jira, store, transitionMemory }, id, issueKey, options);
    invalidateAnalysisListing(projectRoot());
    return outcome;
  } catch (err: unknown) {
    return { kind: 'failed', message: messageOf(err) };
  }
}

// getProjectKey: el proyecto de la app al momento de crear el análisis (queda guardado en él)
export function createAnalysisBridge(getJira: () => JiraService, getProjectKey: () => string | null): AnalysisBridge {
  const transitionMemory = createFileTransitionMemory();
  return {
    create: async (input) => {
      try {
        const projectKey = getProjectKey();
        if (!projectKey) return { ok: false, message: NO_PROJECT };
        const name = cleanAnalysisName(input.name);
        const root = projectRoot();
        const id = nextAnalysisId(await listAnalysisIds(root));
        const store = await openAnalysis(root, id);
        await createAnalysis(store, id, name, projectKey);
        invalidateAnalysisListing(root);
        const hasSources = input.paths.trim() !== '' || input.text.trim() !== '';
        // Ya existe: un fallo al copiar las fuentes no puede llevar a crear otro duplicado
        const results = hasSources
          ? await addSources(store, id, input).catch((err: unknown): SourceResult[] => [
              { source: SOURCES_FAILURE_LABEL, ok: false, message: messageOf(err) },
            ])
          : [];
        return { ok: true, id, results };
      } catch (err: unknown) {
        return { ok: false, message: messageOf(err) };
      }
    },
    load: async (id) => {
      const state = await stateOf(id);
      return {
        id,
        name: state.name,
        sources: state.sources,
        tracking: state.trackingTasks.map((task) => ({
          issueKey: task.issueKey,
          status: state.taskRuns[task.issueKey]?.status ?? 'started',
        })),
      };
    },
    addSources: async (id, input) => {
      try {
        const results = await addSources(await openAnalysis(projectRoot(), id), id, input);
        invalidateAnalysisListing(projectRoot());
        return { ok: true, results };
      } catch (err: unknown) {
        return { ok: false, message: messageOf(err) };
      }
    },
    trackingStatus: async (id) => {
      const state = await stateOf(id);
      return { open: openTrackingOf(state), managementKey: await readManagementKey(projectRoot(), state.projectKey) };
    },
    trackingSuggestion: () => loadPlanningSuggestion(),
    createTracking: async (id, input, whereKey) => {
      try {
        const root = projectRoot();
        const state = await stateOf(id);
        const jira = getJira();
        const outcome = await createAnalysisTracking(
          {
            jira,
            store: await openAnalysis(root, id),
            assigneeId: await projectAssigneeId(jira, state.projectKey),
            transitionMemory,
            management: await readManagementKey(root, state.projectKey),
          },
          id,
          input,
          whereKey,
        );
        invalidateAnalysisListing(root);
        return outcome;
      } catch (err: unknown) {
        return { ok: false, message: messageOf(err) };
      }
    },
  };
}
