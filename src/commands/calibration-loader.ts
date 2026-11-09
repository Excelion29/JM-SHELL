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
import { loadPlan } from '../refinement/plan';
import { planningGroupOf, suggestPlanning } from '../refinement/planning';
import { projectRoot } from '../refinement/state';
import type { CalibrationModel, PlanningSuggestion } from '../refinement/tasks-types';
import type { StoryState } from '../refinement/types';
import { listAllStories, openStory } from './story-resolver';

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

export async function loadCalibration(now: Date = new Date()): Promise<CalibrationModel> {
  const { measured, states, unreadable } = await folderMeasures(now);
  return calibrate(measured, unreadable, planningGroupOf(states));
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
    return suggestPlanning(planningGroupOf(await listAllStories(projectRoot())));
  } catch {
    return suggestPlanning(EMPTY_PLANNING);
  }
}
