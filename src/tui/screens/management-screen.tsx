import React, { useState } from 'react';
import { Box, Text } from 'ink';
// Solo tipos: se borra al compilar
import type { ManagementBridge, ManagementStatus } from '../../refinement/management-types.js';
import type { BrowseItem } from '../../refinement/types.js';
import { EpicPicker } from '../components/epic-picker.js';
import { LoadGate } from '../components/load-gate.js';
import { ManualKeyInput } from '../components/manual-key-input.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { useLoad } from '../components/use-load.js';
import { COLORS, MANAGEMENT_TEXTS as T } from '../texts.js';

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
          texts={{ title: T.pickTitle(projectKey), empty: T.noEpics, nextStep: T.pickNextStep, hint: T.pickHint }}
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
