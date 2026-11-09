import React, { useState } from 'react';
import { Box, Text } from 'ink';
// Solo tipos: se borra al compilar
import type { ManagementBridge, ManagementStatus } from '../../refinement/management-types.js';
import type { BrowseItem } from '../../refinement/types.js';
import { LoadGate } from '../components/load-gate.js';
import { ManualKeyInput } from '../components/manual-key-input.js';
import { PickerList } from '../components/picker-list.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { useLoad } from '../components/use-load.js';
import { BROWSE_LIMIT, BROWSE_TEXTS, COLORS, KEYS, MANAGEMENT_TEXTS as T } from '../texts.js';

interface ManagementScreenProps {
  projectKey: string;
  management: ManagementBridge;
  fetchEpics: () => Promise<BrowseItem[]>;
  // Sale de la pantalla con o sin haber guardado: sin guardar, la pregunta vuelve la próxima vez
  onDone: () => void;
}

type Step = 'ask' | 'pick' | 'manual' | 'saving';

export function ManagementScreen({ projectKey, management, fetchEpics, onDone }: ManagementScreenProps) {
  const { state, retry } = useLoad(() => management.status(projectKey));
  return (
    <LoadGate state={state} loadingText={T.loading} onRetry={retry} onBack={onDone}>
      {(status) => (
        <ManagementFlow
          projectKey={projectKey}
          status={status}
          management={management}
          fetchEpics={fetchEpics}
          onDone={onDone}
        />
      )}
    </LoadGate>
  );
}

interface ManagementFlowProps extends ManagementScreenProps {
  status: ManagementStatus;
}

function ManagementFlow({ projectKey, status, management, fetchEpics, onDone }: ManagementFlowProps) {
  const [step, setStep] = useState<Step>('ask');
  const [error, setError] = useState<string | null>(null);

  const save = async (key: string | null) => {
    setStep('saving');
    setError(null);
    const result = await management
      .save(projectKey, key)
      .catch((err: unknown) => ({ ok: false as const, message: (err as Error).message }));
    if (result.ok) {
      onDone();
      return;
    }
    setError(result.message);
    setStep(key === null ? 'ask' : 'pick');
  };

  const errorLine = error !== null && <Text color={COLORS.error}>{T.saveError(error)}</Text>;

  if (step === 'saving') return <Text>{T.saving}</Text>;
  if (step === 'manual') {
    return <ManualKeyInput onSubmit={(key) => void save(key)} onCancel={() => setStep('pick')} />;
  }
  if (step === 'pick') {
    return (
      <Box flexDirection="column">
        <EpicPicker
          projectKey={projectKey}
          fetchEpics={fetchEpics}
          onChoose={(key) => void save(key)}
          onManual={() => setStep('manual')}
          onBack={() => setStep('ask')}
        />
        {errorLine}
      </Box>
    );
  }
  const current = T.current(status);
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {T.title}
      </Text>
      {current && <Text color={COLORS.brand}>{current}</Text>}
      <Text color={COLORS.muted}>{T.why}</Text>
      <YesNoPrompt question={T.question} onYes={() => setStep('pick')} onNo={() => void save(null)} onCancel={onDone} />
      <Text color={COLORS.muted}>{T.askHint}</Text>
      {errorLine}
    </Box>
  );
}

interface EpicPickerProps {
  projectKey: string;
  fetchEpics: () => Promise<BrowseItem[]>;
  onChoose: (key: string) => void;
  onManual: () => void;
  onBack: () => void;
}

function EpicPicker({ projectKey, fetchEpics, onChoose, onManual, onBack }: EpicPickerProps) {
  const { state, retry } = useLoad(fetchEpics);
  return (
    <LoadGate state={state} loadingText={BROWSE_TEXTS.loadingEpics} onRetry={retry} onBack={onBack}>
      {(epics) => (
        <PickerList
          title={T.pickTitle(projectKey)}
          items={epics.map((epic) => ({ id: epic.key, label: `${epic.key} ${epic.summary}`, detail: epic.status }))}
          emptyText={T.noEpics}
          limitReached={epics.length >= BROWSE_LIMIT}
          nextStep={T.pickNextStep}
          hint={T.pickHint}
          shortcuts={{ [KEYS.manualKey]: onManual, [KEYS.manualKeyAlt]: onManual }}
          onSelect={onChoose}
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}
