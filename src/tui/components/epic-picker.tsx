import React from 'react';
// Solo tipos: se borra al compilar
import type { BrowseItem } from '../../refinement/types.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, KEYS } from '../texts.js';
import { LoadGate } from './load-gate.js';
import { PickerList } from './picker-list.js';
import { useLoad } from './use-load.js';

export interface EpicPickerTexts {
  title: string;
  empty: string;
  nextStep: string;
  hint: string;
}

interface EpicPickerProps {
  texts: EpicPickerTexts;
  fetchEpics: () => Promise<BrowseItem[]>;
  onChoose: (key: string) => void;
  onManual: () => void;
  onBack: () => void;
}

// Lista de épicas del proyecto; `k` abre la escritura a mano de la clave de una historia o épica
export function EpicPicker({ texts, fetchEpics, onChoose, onManual, onBack }: EpicPickerProps) {
  const { state, retry } = useLoad(fetchEpics);
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
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}
