import React, { useState } from 'react';
import type { BrowseItem, StorySummary } from '../../refinement/types.js';
import { LoadGate } from '../components/load-gate.js';
import { ManualKeyInput } from '../components/manual-key-input.js';
import { PickerItem, PickerList } from '../components/picker-list.js';
import { useLoad } from '../components/use-load.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, FOOTER_HINTS, KEYS, NO_EPIC_ID } from '../texts.js';

export interface BrowseScreenProps {
  localStories: StorySummary[];
  fetchEpics: () => Promise<BrowseItem[]>;
  fetchStories: (epicKey: string | null) => Promise<BrowseItem[]>;
  onRefine: (key: string) => void;
  onChangeProject: () => void;
  onBack: () => void;
}

type Level = { name: 'epics' } | { name: 'stories'; epic: string | null } | { name: 'manual'; from: Level };

export function BrowseScreen({
  localStories,
  fetchEpics,
  fetchStories,
  onRefine,
  onChangeProject,
  onBack,
}: BrowseScreenProps) {
  const [level, setLevel] = useState<Level>({ name: 'epics' });

  const shortcuts = (current: Level) => ({
    [KEYS.manualKey]: () => setLevel({ name: 'manual', from: current }),
    [KEYS.manualKeyAlt]: () => setLevel({ name: 'manual', from: current }),
    [KEYS.changeProject]: onChangeProject,
  });

  if (level.name === 'manual') {
    return <ManualKeyInput onSubmit={onRefine} onCancel={() => setLevel(level.from)} />;
  }
  if (level.name === 'epics') {
    return (
      <EpicsLevel
        fetchEpics={fetchEpics}
        shortcuts={shortcuts(level)}
        onOpen={(epic) => setLevel({ name: 'stories', epic })}
        onBack={onBack}
      />
    );
  }
  return (
    <StoriesLevel
      epic={level.epic}
      localStories={localStories}
      fetchStories={fetchStories}
      shortcuts={shortcuts(level)}
      onSelect={onRefine}
      onBack={() => setLevel({ name: 'epics' })}
    />
  );
}

interface EpicsLevelProps {
  fetchEpics: () => Promise<BrowseItem[]>;
  shortcuts: Record<string, () => void>;
  onOpen: (epic: string | null) => void;
  onBack: () => void;
}

function EpicsLevel({ fetchEpics, shortcuts, onOpen, onBack }: EpicsLevelProps) {
  const { state, retry } = useLoad(fetchEpics);
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingEpics} onRetry={retry} onBack={onBack}>
      {(epics) => {
        const items: PickerItem[] = [
          { id: NO_EPIC_ID, label: BROWSE_TEXTS.noEpicLabel },
          ...epics.map((epic) => ({ id: epic.key, label: `${epic.key} ${epic.summary}`, detail: epic.status })),
        ];
        return (
          <PickerList
            title={BROWSE_TEXTS.epicsTitle}
            items={items}
            limitReached={epics.length >= BROWSE_LIMIT}
            nextStep={BROWSE_TEXTS.epicsNextStep}
            hint={FOOTER_HINTS.picker}
            shortcuts={shortcuts}
            onSelect={(id) => onOpen(id === NO_EPIC_ID ? null : id)}
            onBack={onBack}
          />
        );
      }}
    </LoadGate>
  );
}

interface StoriesLevelProps {
  epic: string | null;
  localStories: StorySummary[];
  fetchStories: (epicKey: string | null) => Promise<BrowseItem[]>;
  shortcuts: Record<string, () => void>;
  onSelect: (key: string) => void;
  onBack: () => void;
}

function StoriesLevel({ epic, localStories, fetchStories, shortcuts, onSelect, onBack }: StoriesLevelProps) {
  const { state, retry } = useLoad(() => fetchStories(epic));
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingStories} onRetry={retry} onBack={onBack}>
      {(stories) => {
        const items: PickerItem[] = stories.map((story) => {
          const local = localStories.find((l) => l.key === story.key);
          return {
            id: story.key,
            label: `${story.key} ${story.summary}`,
            detail: story.status,
            tag: local ? BROWSE_TEXTS.localMarker(local.phase) : undefined,
          };
        });
        return (
          <PickerList
            title={epic ? BROWSE_TEXTS.storiesTitle(epic) : BROWSE_TEXTS.noEpicStoriesTitle}
            items={items}
            emptyText={BROWSE_TEXTS.emptyStories}
            limitReached={stories.length >= BROWSE_LIMIT}
            nextStep={BROWSE_TEXTS.storiesNextStep}
            hint={FOOTER_HINTS.picker}
            shortcuts={shortcuts}
            onSelect={onSelect}
            onBack={onBack}
          />
        );
      }}
    </LoadGate>
  );
}
