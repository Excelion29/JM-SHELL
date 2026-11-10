import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar, la isla ESM no importa código CJS
import type { StorySummary } from '../../refinement/types.js';
import { COLORS, HOME_TEXTS, KEYS } from '../texts.js';

interface HomeScreenProps {
  stories: StorySummary[];
  onRefine: (key: string) => void;
  onBrowse: () => void;
  onChangeProject: () => void;
  onReview: (key: string) => void;
  onCloseStory: (key: string) => void;
  onTasks: (key: string) => void;
  onMyDay: () => void;
  onKnowledge: () => void;
  onCalibration: () => void;
  onManagement?: () => void;
  onNewAnalysis?: () => void;
  onAnalysis?: (id: string) => void;
  // null: el cursor no está sobre un análisis (se avisa en vez de no hacer nada)
  onAnalysisDetail?: (id: string | null) => void;
  // t sobre un análisis: sus puntos (tareas solo de jm)
  onAnalysisPoints?: (id: string) => void;
  // v sobre un análisis: lo vincula a Jira; null: v sobre una historia (se avisa que solo aplica a análisis)
  onAnalysisLink?: (id: string | null) => void;
  // x o Supr sobre un análisis; null: Supr sobre una historia (se avisa que solo se borran análisis)
  onDeleteAnalysis?: (id: string | null) => void;
  // Tecla que no aplica a la fila elegida: se explica en vez de no hacer nada
  onNotice?: (message: string) => void;
  onQuit: () => void;
}

// Tras crear, r sigue abierto para crear las tareas que se agreguen al plan
const REVIEW_PHASES: readonly string[] = ['plan', 'reviewed', 'created', 'in-progress'];
const CLOSE_PHASES: readonly string[] = ['created', 'in-progress'];
const TASKS_PHASES: readonly string[] = ['created', 'in-progress'];
const CLOSED_PHASES: readonly string[] = ['closed'];
const REFINING_PHASES: readonly string[] = ['spec', 'debate'];

export function HomeScreen({
  stories,
  onRefine,
  onBrowse,
  onChangeProject,
  onReview,
  onCloseStory,
  onTasks,
  onMyDay,
  onKnowledge,
  onCalibration,
  onManagement,
  onNewAnalysis,
  onAnalysis,
  onAnalysisDetail,
  onAnalysisPoints,
  onAnalysisLink,
  onDeleteAnalysis,
  onNotice,
  onQuit,
}: HomeScreenProps) {
  const [selected, setSelected] = useState(0);
  const current = stories[selected];

  useInput((input, key) => {
    if (input === KEYS.quit) onQuit();
    else if (input === KEYS.newStory) onBrowse();
    else if (input === KEYS.changeProject) onChangeProject();
    else if (input === KEYS.review && current?.kind === 'analysis') onNotice?.(HOME_TEXTS.analysisHasNoTasks);
    else if (input === KEYS.tasks && current?.kind === 'analysis') onAnalysisPoints?.(current.key);
    else if (input === KEYS.review && current?.phaseId && REVIEW_PHASES.includes(current.phaseId))
      onReview(current.key);
    else if (input === KEYS.review && current?.phaseId && REFINING_PHASES.includes(current.phaseId))
      onNotice?.(HOME_TEXTS.reviewNotYet);
    else if (input === KEYS.closeStory && current?.kind === 'analysis') onDeleteAnalysis?.(current.key);
    else if (key.delete) onDeleteAnalysis?.(current?.kind === 'analysis' ? current.key : null);
    else if (input === KEYS.closeStory && current?.phaseId && CLOSE_PHASES.includes(current.phaseId))
      onCloseStory(current.key);
    else if (input === KEYS.tasks && current?.phaseId && TASKS_PHASES.includes(current.phaseId)) onTasks(current.key);
    else if (input === KEYS.tasks && current?.phaseId && !CLOSED_PHASES.includes(current.phaseId))
      onNotice?.(HOME_TEXTS.tasksNotYet);
    else if (input === KEYS.myDay) onMyDay();
    else if (input === KEYS.knowledgeBase) onKnowledge();
    else if (input === KEYS.calibration) onCalibration();
    else if (input === KEYS.management) onManagement?.();
    else if (input === KEYS.newAnalysis) onNewAnalysis?.();
    else if (input === KEYS.linkAnalysis) onAnalysisLink?.(current?.kind === 'analysis' ? current.key : null);
    else if (input === KEYS.detail) onAnalysisDetail?.(current?.kind === 'analysis' ? current.key : null);
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(stories.length - 1, i + 1));
    else if (key.return && current) {
      if (current.kind === 'analysis') onAnalysis?.(current.key);
      else onRefine(current.key);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {HOME_TEXTS.title}
      </Text>
      {stories.length === 0 ? (
        <Text>{HOME_TEXTS.empty}</Text>
      ) : (
        stories.map((story, index) => <StoryRow key={story.key} story={story} active={index === selected} />)
      )}
      <Text color={COLORS.muted}>
        {stories.length === 0 ? HOME_TEXTS.nextStep : (stories[selected]?.nextStep ?? HOME_TEXTS.listNextStep)}
      </Text>
    </Box>
  );
}

function StoryRow({ story, active }: { story: StorySummary; active: boolean }) {
  const marker = active ? HOME_TEXTS.selectedMarker : ' ';
  if (story.kind === 'analysis') {
    return (
      <Text color={active ? COLORS.brand : undefined}>
        {marker} {HOME_TEXTS.analysisMarker} {story.key} · {story.summary} · {story.phase}
        {story.block !== HOME_TEXTS.noBlock && ` · ${HOME_TEXTS.blockLabel}: ${story.block}`}
        {story.linkedEpicKey && ` ${HOME_TEXTS.linkedTo(story.linkedEpicKey)}`}
      </Text>
    );
  }
  return (
    <Text color={active ? COLORS.brand : undefined}>
      {marker} {story.key} · {story.summary} · {story.phase} · {HOME_TEXTS.blockLabel}: {story.block}
    </Text>
  );
}
