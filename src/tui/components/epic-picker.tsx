import React, { useState } from 'react';
// Solo tipos: se borra al compilar
import type { BrowseItem } from '../../refinement/types.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, EPIC_STORIES_TEXTS, KEYS, NO_EPIC_ID, type Hint } from '../texts.js';
import { toPickerItem } from './issue-type-color.js';
import { LoadGate } from './load-gate.js';
import { PickerItem, PickerList } from './picker-list.js';
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
  // Con esto, → sobre una épica muestra sus historias; null trae los tickets sin épica
  fetchStories?: (epicKey: string | null) => Promise<BrowseItem[]>;
  onChoose: (key: string) => void;
  onManual: () => void;
  onBack: () => void;
}

// Lo abierto con →: una épica o la lista de tickets sin épica (epic null)
type Opened = { epic: BrowseItem | null };

// Lista de épicas del proyecto; `k` abre la escritura a mano de la clave de una historia o épica
export function EpicPicker({ texts, fetchEpics, fetchStories, onChoose, onManual, onBack }: EpicPickerProps) {
  const { state, retry } = useLoad(fetchEpics);
  const [opened, setOpened] = useState<Opened | null>(null);
  if (opened && fetchStories) {
    return (
      <EpicStoriesPicker
        epic={opened.epic}
        fetchStories={fetchStories}
        onChoose={onChoose}
        onManual={onManual}
        onBack={() => setOpened(null)}
      />
    );
  }
  const open = (key: string, epics: BrowseItem[]) => {
    if (key === NO_EPIC_ID) return setOpened({ epic: null });
    const epic = epics.find((item) => item.key === key);
    if (epic) setOpened({ epic });
  };
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingEpics} onRetry={retry} onBack={onBack}>
      {(epics) => {
        // Sin fetchStories no hay cómo listar los sueltos: la fila no se ofrece
        const looseRow: PickerItem[] = fetchStories ? [{ id: NO_EPIC_ID, label: BROWSE_TEXTS.noEpicLabel }] : [];
        return (
          <PickerList
            title={texts.title}
            items={[...looseRow, ...epics.map(toPickerItem)]}
            emptyText={texts.empty}
            limitReached={epics.length >= BROWSE_LIMIT}
            nextStep={texts.nextStep}
            hint={texts.hint}
            shortcuts={{ [KEYS.manualKey]: onManual, [KEYS.manualKeyAlt]: onManual }}
            onSelect={(key) => (key === NO_EPIC_ID ? open(key, epics) : onChoose(key))}
            onOpen={fetchStories ? (key) => open(key, epics) : undefined}
            onBack={onBack}
          />
        );
      }}
    </LoadGate>
  );
}

interface EpicStoriesPickerProps {
  epic: BrowseItem | null;
  fetchStories: (epicKey: string | null) => Promise<BrowseItem[]>;
  onChoose: (key: string) => void;
  onManual: () => void;
  onBack: () => void;
}

// Dentro de una épica: la misma épica primero y luego sus historias. Sin épica: los tickets sueltos
function EpicStoriesPicker({ epic, fetchStories, onChoose, onManual, onBack }: EpicStoriesPickerProps) {
  const { state, retry } = useLoad(() => fetchStories(epic?.key ?? null));
  const epicRow: PickerItem[] = epic ? [{ id: epic.key, label: EPIC_STORIES_TEXTS.useEpic(epic.key) }] : [];
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingStories} onRetry={retry} onBack={onBack}>
      {(stories) => (
        <PickerList
          title={epic ? EPIC_STORIES_TEXTS.title(epic.key, epic.summary) : BROWSE_TEXTS.noEpicStoriesTitle}
          items={[...epicRow, ...stories.map(toPickerItem)]}
          emptyText={BROWSE_TEXTS.emptyStories}
          limitReached={stories.length >= BROWSE_LIMIT}
          nextStep={epic ? EPIC_STORIES_TEXTS.nextStep : EPIC_STORIES_TEXTS.looseNextStep}
          hint={EPIC_STORIES_TEXTS.hint}
          shortcuts={{ [KEYS.manualKey]: onManual, [KEYS.manualKeyAlt]: onManual }}
          onSelect={onChoose}
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}
