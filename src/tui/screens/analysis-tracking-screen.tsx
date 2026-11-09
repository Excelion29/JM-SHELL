import React from 'react';
// Solo tipos: se borra al compilar
import type { AnalysisBridge } from '../../refinement/analysis-types.js';
import type { BrowseItem } from '../../refinement/types.js';
import { ANALYSIS_TEXTS as T } from '../texts.js';
import { PlanningFlow, type PlanningFlowLabels, type PlanningFlowSource } from './planning-screen.js';

interface AnalysisTrackingScreenProps {
  id: string;
  name: string;
  analysis: AnalysisBridge;
  fetchEpics: () => Promise<BrowseItem[]>;
  // Sigue al análisis: con un aviso y la tarea abierta (para preguntar al salir), si las hay
  onDone: (notice: string | null, taskKey: string | null) => void;
}

// Al entrar a un análisis: ¿registro la tarea "Análisis · <nombre> · fecha"? Sin gestión pregunta dónde
export function AnalysisTrackingScreen({ id, name, analysis, fetchEpics, onDone }: AnalysisTrackingScreenProps) {
  const source: PlanningFlowSource = {
    status: () => analysis.trackingStatus(id),
    suggest: () => analysis.trackingSuggestion(),
    create: (input, whereKey) => analysis.createTracking(id, input, whereKey),
  };
  const labels = (managementKey: string | null): PlanningFlowLabels => ({
    question: T.tracking.question(name, managementKey),
    why: managementKey ? T.tracking.whyManagement(managementKey) : T.tracking.why,
    formTitle: T.tracking.formTitle(name),
    continueHint: T.tracking.continueHint,
    stillOpen: T.tracking.stillOpen,
    created: T.tracking.created,
    createdNotStarted: T.tracking.createdNotStarted,
  });
  return <PlanningFlow key={id} source={source} labels={labels} where={{ fetchEpics }} onDone={onDone} />;
}
