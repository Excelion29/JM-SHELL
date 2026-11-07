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
  onQuit: () => void;
}

// Tras crear, r sigue abierto para crear las tareas que se agreguen al plan
const REVIEW_PHASES: readonly string[] = ['plan', 'reviewed', 'created', 'in-progress'];
const CLOSE_PHASES: readonly string[] = ['created', 'in-progress'];
const TASKS_PHASES: readonly string[] = ['created', 'in-progress'];

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
  onQuit,
}: HomeScreenProps) {
  const [selected, setSelected] = useState(0);
  const current = stories[selected];

  useInput((input, key) => {
    if (input === KEYS.quit) onQuit();
    else if (input === KEYS.newStory) onBrowse();
    else if (input === KEYS.changeProject) onChangeProject();
    else if (input === KEYS.review && current?.phaseId && REVIEW_PHASES.includes(current.phaseId)) onReview(current.key);
    else if (input === KEYS.closeStory && current?.phaseId && CLOSE_PHASES.includes(current.phaseId)) onCloseStory(current.key);
    else if (input === KEYS.tasks && current?.phaseId && TASKS_PHASES.includes(current.phaseId)) onTasks(current.key);
    else if (input === KEYS.myDay) onMyDay();
    else if (input === KEYS.knowledgeBase) onKnowledge();
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(stories.length - 1, i + 1));
    else if (key.return && stories[selected]) onRefine(stories[selected].key);
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
  return (
    <Text color={active ? COLORS.brand : undefined}>
      {marker} {story.key} · {story.summary} · {story.phase} · {HOME_TEXTS.blockLabel}: {story.block}
    </Text>
  );
}
