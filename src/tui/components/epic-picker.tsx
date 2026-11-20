import React, { useState } from 'react';
// Solo tipos: se borra al compilar
import type { BrowseItem } from '../../refinement/types.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, EPIC_STORIES_TEXTS, KEYS, type Hint } from '../texts.js';
import { LoadGate } from './load-gate.js';
import { PickerList } from './picker-list.js';
import { useLoad } from './use-load.js';

export interface EpicPickerTexts {
  title: string;
  empty: string;
  nextStep: string;
  hint: Hint;
}

interface EpicPickerProps {
  texts: EpicPickerTexts;
  fetchEpics: () => Promise<BrowseItem[]>;
  // Con esto, → sobre una épica muestra sus historias para elegir una de ellas
  fetchStories?: (epicKey: string) => Promise<BrowseItem[]>;
  onChoose: (key: string) => void;
  onManual: () => void;
  onBack: () => void;
}

// Lista de épicas del proyecto; `k` abre la escritura a mano de la clave de una historia o épica
export function EpicPicker({ texts, fetchEpics, fetchStories, onChoose, onManual, onBack }: EpicPickerProps) {
  const { state, retry } = useLoad(fetchEpics);
  const [openEpic, setOpenEpic] = useState<BrowseItem | null>(null);
  if (openEpic && fetchStories) {
    return (
      <EpicStoriesPicker
        epic={openEpic}
        fetchStories={fetchStories}
        onChoose={onChoose}
        onManual={onManual}
        onBack={() => setOpenEpic(null)}
      />
    );
  }
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingEpics} onRetry={retry} onBack={onBack}>
      {(epics) => (
        <PickerList
          title={texts.title}
          items={epics.map((epic) => ({ id: epic.key, label: `${epic.key} ${epic.summary}`, detail: epic.status }))}
          emptyText={texts.empty}
          limitReached={epics.length >= BROWSE_LIMIT}
          nextStep={texts.nextStep}
          hint={texts.hint}
          shortcuts={{ [KEYS.manualKey]: onManual, [KEYS.manualKeyAlt]: onManual }}
          onSelect={onChoose}
          onOpen={fetchStories ? (key) => setOpenEpic(epics.find((epic) => epic.key === key) ?? null) : undefined}
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}

interface EpicStoriesPickerProps {
  epic: BrowseItem;
  fetchStories: (epicKey: string) => Promise<BrowseItem[]>;
  onChoose: (key: string) => void;
  onManual: () => void;
  onBack: () => void;
}

// Dentro de una épica: la misma épica primero y luego sus historias, con filtro al escribir
function EpicStoriesPicker({ epic, fetchStories, onChoose, onManual, onBack }: EpicStoriesPickerProps) {
  const { state, retry } = useLoad(() => fetchStories(epic.key));
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingStories} onRetry={retry} onBack={onBack}>
      {(stories) => (
        <PickerList
          title={EPIC_STORIES_TEXTS.title(epic.key, epic.summary)}
          items={[
            { id: epic.key, label: EPIC_STORIES_TEXTS.useEpic(epic.key) },
            ...stories.map((story) => ({
              id: story.key,
              label: `${story.key} ${story.summary}`,
              detail: story.status,
            })),
          ]}
          limitReached={stories.length >= BROWSE_LIMIT}
          nextStep={EPIC_STORIES_TEXTS.nextStep}
          hint={EPIC_STORIES_TEXTS.hint}
          shortcuts={{ [KEYS.manualKey]: onManual, [KEYS.manualKeyAlt]: onManual }}
          onSelect={onChoose}
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}
