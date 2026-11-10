import type { JiraService } from '../services/jira';
import {
  cleanAnalysisName,
  createAnalysis,
  nextAnalysisId,
  openTrackingOf,
  readAnalysis,
} from '../refinement/analysis';
import type { AnalysisBridge, AnalysisState, SourceResult } from '../refinement/analysis-types';
import {
  createLinkedPoints,
  finishLinkedNotice,
  linkedIssueOf,
  resolveLinkTarget,
  returnLinked,
  setAnalysisEpic,
  startLinked,
} from '../refinement/analysis-link';
import { removeAnalysis } from '../refinement/analysis-remove';
import { finishPoint, giveBackPoint, loadPointsModel, startPoint } from '../refinement/analysis-point-runs';
import { addSources } from '../refinement/analysis-sources';
import { createAnalysisTracking, finishAnalysisTask } from '../refinement/analysis-tracking';
import { returnOptions } from '../refinement/execution';
import type { TransitionOptions, TransitionOutcome } from '../refinement/tasks-types';
import { createFileTransitionMemory, type TransitionMemory } from '../refinement/transition-memory';
import { projectRoot } from '../refinement/state';
import { workDirFor } from '../refinement/workdir';
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
  const storeOf = (id: string) => openAnalysis(projectRoot(), id);
  // Un punto vinculado también mueve su tarea en Jira: si falla, el punto ya cambió en jm y solo se avisa
  const withLinked = async (
    id: string,
    pointId: string,
    move: (issueKey: string) => Promise<string | null>,
  ): Promise<string | null> => {
    try {
      const issueKey = await linkedIssueOf(await storeOf(id), id, pointId);
      return issueKey ? await move(issueKey) : null;
    } catch (err: unknown) {
      return messageOf(err);
    }
  };
  const jiraDeps = () => ({ jira: getJira(), transitionMemory });
  // Los puntos cambian el estado.json del análisis: el inicio debe releerlo
  const afterChange = async <T>(change: Promise<T>): Promise<T> => {
    try {
      return await change;
    } finally {
      invalidateAnalysisListing(projectRoot());
    }
  };
  return {
    points: {
      load: async (id) => loadPointsModel(await storeOf(id), id),
      start: async (id, pointId, options) => {
        const outcome = await afterChange(startPoint(await storeOf(id), id, pointId, options));
        if (outcome.kind !== 'ok') return outcome;
        const notice = await withLinked(id, pointId, (key) => startLinked(jiraDeps(), key));
        return notice ? { kind: 'ok', notice } : outcome;
      },
      finish: async (id, pointId) => {
        await afterChange(finishPoint(await storeOf(id), id, pointId));
        return withLinked(id, pointId, (key) => finishLinkedNotice(jiraDeps(), key));
      },
      returnOptions: async (id, pointId) => {
        try {
          const issueKey = await linkedIssueOf(await storeOf(id), id, pointId);
          return issueKey ? await returnOptions(getJira(), issueKey) : [];
        } catch {
          return []; // sin las transiciones el punto se devuelve solo en jm y la pantalla avisa
        }
      },
      giveBack: async (id, pointId, transitionName) => {
        await afterChange(giveBackPoint(await storeOf(id), id, pointId));
        if (!transitionName) return null;
        return withLinked(id, pointId, (key) => returnLinked(getJira(), key, transitionName));
      },
    },
    link: {
      load: async (id) => {
        const state = await stateOf(id);
        return { epicKey: state.link?.epicKey ?? null, points: await loadPointsModel(await storeOf(id), id) };
      },
      resolveTarget: async (id, key, mustBeEpic) =>
        resolveLinkTarget(getJira(), (await stateOf(id)).projectKey, key, mustBeEpic),
      setEpic: async (id, epicKey) => afterChange(setAnalysisEpic(await storeOf(id), id, epicKey)),
      create: async (id, targets) => {
        const jira = getJira();
        const state = await stateOf(id);
        return afterChange(
          createLinkedPoints(
            {
              jira,
              store: await storeOf(id),
              assigneeId: await projectAssigneeId(jira, state.projectKey),
              transitionMemory,
            },
            id,
            targets,
          ),
        );
      },
    },
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
        documented: state.phase === 'documented',
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
    remove: async (id) => {
      const root = projectRoot();
      try {
        return await removeAnalysis(await openAnalysis(root, id), workDirFor(root), id);
      } catch (err: unknown) {
        return { ok: false, message: messageOf(err) };
      } finally {
        // También tras un fallo a medias: el inicio debe ver lo que quedó
        invalidateAnalysisListing(root);
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
