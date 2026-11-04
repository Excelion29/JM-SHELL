import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProjectItem } from '../../refinement/types.js';
import { LoadGate } from '../components/load-gate.js';
import { PickerList } from '../components/picker-list.js';
import { useLoad } from '../components/use-load.js';
import { BROWSE_TEXTS, COLORS, FOOTER_HINTS, KEYS, PROJECT_TEXTS } from '../texts.js';

export interface SetProjectResult {
  ok: boolean;
  message?: string;
}

interface ProjectScreenProps {
  currentKey: string | null;
  fetchProjects: () => Promise<ProjectItem[]>;
  setProject: (key: string) => Promise<SetProjectResult>;
  onChanged: (key: string) => void | Promise<void>;
  onBack: () => void;
}

type Phase = { name: 'pick' } | { name: 'confirm'; key: string } | { name: 'saving' };

export function ProjectScreen({ currentKey, fetchProjects, setProject, onChanged, onBack }: ProjectScreenProps) {
  const { state, retry } = useLoad(fetchProjects);
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (key: string) => {
    setPhase({ name: 'saving' });
    setSaveError(null);
    try {
      const result = await setProject(key);
      if (result.ok) {
        await onChanged(key);
        return;
      }
      setSaveError(result.message ?? '');
    } catch (err: unknown) {
      setSaveError((err as Error).message);
    }
    setPhase({ name: 'pick' });
  };

  const choose = (key: string) => {
    if (key === currentKey) onBack();
    else if (currentKey) setPhase({ name: 'confirm', key });
    else void save(key);
  };

  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingProjects} onRetry={retry} onBack={onBack}>
      {(projects) => {
        if (phase.name === 'saving') return <Text>{PROJECT_TEXTS.saving}</Text>;
        if (phase.name === 'confirm') {
          return (
            <Confirm
              question={PROJECT_TEXTS.confirm(currentKey ?? '', phase.key)}
              onYes={() => void save(phase.key)}
              onNo={() => setPhase({ name: 'pick' })}
            />
          );
        }
        return (
          <Box flexDirection="column">
            <PickerList
              title={PROJECT_TEXTS.title}
              items={projects.map((p) => ({ id: p.key, label: p.key, detail: p.name }))}
              emptyText={PROJECT_TEXTS.noProjects}
              nextStep={PROJECT_TEXTS.nextStep}
              hint={FOOTER_HINTS.projects}
              onSelect={choose}
              onBack={onBack}
            />
            {saveError !== null && (
              <>
                <Text color={COLORS.error}>{PROJECT_TEXTS.saveError(saveError)}</Text>
                <Text color={COLORS.muted}>{PROJECT_TEXTS.saveErrorNextStep}</Text>
              </>
            )}
          </Box>
        );
      }}
    </LoadGate>
  );
}

function Confirm({ question, onYes, onNo }: { question: string; onYes: () => void; onNo: () => void }) {
  useInput((input, key) => {
    const answer = input.toLowerCase();
    if (answer === KEYS.confirmYes || answer === KEYS.confirmYesAlt) onYes();
    else if (answer === KEYS.confirmNo || key.escape) onNo();
  });
  return <Text color={COLORS.accent}>{question}</Text>;
}
