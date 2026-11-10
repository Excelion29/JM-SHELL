// Calibración de todas las historias de esta carpeta: la usan la pantalla de calibración, la revisión del plan
// y la sugerencia de la tarea de Planificación
import {
  calibrate,
  EMPTY_PLANNING,
  estimateFactors,
  type EstimateFactors,
  measuresOf,
  NO_FACTORS,
  type StoryMeasures,
} from '../refinement/calibration';
import { loadPoints } from '../refinement/analysis-points';
import { type PointsCalibrationSource, pointsGroupOf } from '../refinement/analysis-point-runs';
import { loadPlan } from '../refinement/plan';
import { type PlanningSource, planningGroupOf, suggestPlanning } from '../refinement/planning';
import { projectRoot } from '../refinement/state';
import type { CalibrationModel, PlanningSuggestion } from '../refinement/tasks-types';
import type { StoryState } from '../refinement/types';
import { listAllAnalyses, listAllStories, openAnalysis, openStory } from './story-resolver';

interface FolderMeasures {
  measured: StoryMeasures[];
  states: StoryState[];
  unreadable: number;
}

// Una historia que no se pueda leer se cuenta aparte y no frena el resto
async function folderMeasures(now: Date): Promise<FolderMeasures> {
  const root = projectRoot();
  const stories = await listAllStories(root);
  const measured: StoryMeasures[] = [];
  const states: StoryState[] = [];
  let unreadable = 0;
  for (const state of stories) {
    try {
      const { store } = await openStory(root, state.key);
      const plan = await loadPlan(store).catch(() => null);
      measured.push(measuresOf(state, plan, now));
      states.push(state);
    } catch {
      unreadable += 1;
    }
  }
  return { measured, states, unreadable };
}

// Las tareas de los análisis sin historia se miden junto a las Planificaciones; los que no se pueden leer se cuentan
// aparte (como las historias) y no frenan el resto
interface AnalysisSources {
  sources: PlanningSource[];
  points: PointsCalibrationSource[];
  unreadable: number;
}

// Los puntos de un análisis cuyo puntos.json no se puede leer simplemente no se miden
async function pointsSourceOf(id: string, runs: PointsCalibrationSource['runs']): Promise<PointsCalibrationSource | null> {
  if (Object.keys(runs).length === 0) return null;
  try {
    const points = await loadPoints(await openAnalysis(projectRoot(), id));
    return points ? { points, runs } : null;
  } catch {
    return null;
  }
}

async function analysisSources(): Promise<AnalysisSources> {
  try {
    const analyses = await listAllAnalyses(projectRoot());
    const readable = analyses.filter((a) => !a.unreadable);
    const points = await Promise.all(readable.map((a) => pointsSourceOf(a.id, a.pointRuns)));
    return {
      sources: readable.map((a) => ({ planningTasks: a.trackingTasks, taskRuns: a.taskRuns })),
      points: points.filter((source): source is PointsCalibrationSource => source !== null),
      unreadable: analyses.length - readable.length,
    };
  } catch {
    return { sources: [], points: [], unreadable: 1 };
  }
}

export async function loadCalibration(now: Date = new Date()): Promise<CalibrationModel> {
  const { measured, states, unreadable } = await folderMeasures(now);
  const analyses = await analysisSources();
  return calibrate(
    measured,
    unreadable + analyses.unreadable,
    planningGroupOf([...states, ...analyses.sources]),
    pointsGroupOf(analyses.points),
  );
}

// La sugerencia es opcional: sin poder leer el historial la revisión sigue igual, solo sin el ajustado
export async function loadEstimateFactors(): Promise<EstimateFactors> {
  try {
    return estimateFactors((await folderMeasures(new Date())).measured);
  } catch {
    return NO_FACTORS;
  }
}

// Solo hace falta el estado de cada historia (no su plan). Sin historial legible se sugiere la estimación por
// defecto: el dev la puede cambiar en el formulario
export async function loadPlanningSuggestion(): Promise<PlanningSuggestion> {
  try {
    return suggestPlanning(planningGroupOf([...(await listAllStories(projectRoot())), ...(await analysisSources()).sources]));
  } catch {
    return suggestPlanning(EMPTY_PLANNING);
  }
}
