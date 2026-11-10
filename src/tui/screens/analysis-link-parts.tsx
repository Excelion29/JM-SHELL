import React from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { LinkPointResult } from '../../refinement/analysis-types.js';
import type { BrowseItem } from '../../refinement/types.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, COLORS, FOOTER_HINTS, KEYS, LINK_TEXTS as T } from '../texts.js';
import { LoadGate } from '../components/load-gate.js';
import { PickerList } from '../components/picker-list.js';
import { useLoad } from '../components/use-load.js';

// Épica ya vinculada: Enter la conserva y e abre la lista para cambiarla
export function EpicKept({ epicKey, onKeep, onChange, onBack }: {
  epicKey: string;
  onKeep: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  useInput((input, key) => {
    if (key.return) onKeep();
    else if (input === KEYS.edit) onChange();
    else if (key.escape) onBack();
  });
  return (
    <Box flexDirection="column">
      <Text bold>{T.epicCurrent(epicKey)}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.linkEpic}</Text>
    </Box>
  );
}

interface TargetPickerProps {
  epicKey: string | null;
  fetchStories: (epicKey: string | null) => Promise<BrowseItem[]>;
  onChoose: (key: string, isEpic: boolean) => void;
  onManual: () => void;
  onBack: () => void;
}

// Destino de los puntos marcados: la épica, una historia de la épica o una clave a mano
export function TargetPicker({ epicKey, fetchStories, onChoose, onManual, onBack }: TargetPickerProps) {
  const { state, retry } = useLoad(() => (epicKey ? fetchStories(epicKey) : Promise.resolve([])));
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingStories} onRetry={retry} onBack={onBack}>
      {(stories) => (
        <PickerList
          title={T.targetTitle}
          items={[
            ...(epicKey ? [{ id: epicKey, label: T.epicOption(epicKey) }] : []),
            ...stories.map((story) => ({ id: story.key, label: `${story.key} ${story.summary}`, detail: story.status })),
          ]}
          emptyText={T.targetEmpty}
          limitReached={stories.length >= BROWSE_LIMIT}
          nextStep={T.targetNextStep}
          hint={FOOTER_HINTS.linkPicker}
          shortcuts={{ [KEYS.manualKey]: onManual, [KEYS.manualKeyAlt]: onManual }}
          onSelect={(key) => onChoose(key, key === epicKey)}
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}

export function LinkResult({ results, onBack }: { results: LinkPointResult[]; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });
  const created = results.filter((result) => result.ok).length;
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {T.resultTitle}
      </Text>
      {results.map((result) => (
        <Text key={result.pointId} color={result.ok && !result.message ? undefined : COLORS.error}>
          {result.ok && result.issueKey
            ? result.message
              ? T.createdNote(result.pointId, result.issueKey, result.message)
              : T.created(result.pointId, result.issueKey)
            : T.failed(result.pointId, result.message ?? '')}
        </Text>
      ))}
      <Text bold>{T.summary(created, results.length - created)}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.linkDone}</Text>
    </Box>
  );
}
