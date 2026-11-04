import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
// Solo tipos: se borra al compilar, la isla ESM no importa código CJS
import type { StorySummary } from '../../refinement/types.js';
import { COLORS, HOME_TEXTS, ISSUE_KEY_PATTERN, KEYS } from '../texts.js';

interface HomeScreenProps {
  stories: StorySummary[];
  onRefine: (key: string) => void;
  onQuit: () => void;
}

type Mode = 'list' | 'new-story';

export function HomeScreen({ stories, onRefine, onQuit }: HomeScreenProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  useInput(
    (input, key) => {
      if (input === KEYS.quit) onQuit();
      else if (input === KEYS.newStory) setMode('new-story');
      else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(stories.length - 1, i + 1));
      else if (key.return && stories[selected]) onRefine(stories[selected].key);
    },
    { isActive: mode === 'list' },
  );

  useInput(
    (_input, key) => {
      if (!key.escape) return;
      setMode('list');
      setDraft('');
      setInvalid(false);
    },
    { isActive: mode === 'new-story' },
  );

  const submitKey = (value: string) => {
    const candidate = value.trim().toUpperCase();
    if (!ISSUE_KEY_PATTERN.test(candidate)) {
      setInvalid(true);
      return;
    }
    onRefine(candidate);
  };

  if (mode === 'new-story') {
    return (
      <Box flexDirection="column">
        <Text bold color={COLORS.accent}>
          {HOME_TEXTS.newStoryTitle}
        </Text>
        <Box>
          <Text>{HOME_TEXTS.newStoryLabel}</Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={submitKey} />
        </Box>
        {invalid && <Text color={COLORS.error}>{HOME_TEXTS.invalidKey}</Text>}
        <Text color={COLORS.muted}>{HOME_TEXTS.newStoryNextStep}</Text>
      </Box>
    );
  }

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
