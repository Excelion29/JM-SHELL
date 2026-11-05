import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ClosePreview, CloseResult, PlanBridge } from '../../refinement/review-types.js';
import { LoadGate } from '../components/load-gate.js';
import { useLoad } from '../components/use-load.js';
import { CLOSE_TEXTS, COLORS, FOOTER_HINTS, KEYS } from '../texts.js';

interface CloseScreenProps {
  storyKey: string;
  plan: PlanBridge;
  onBack: () => void;
}

export function CloseScreen({ storyKey, plan, onBack }: CloseScreenProps) {
  const { state, retry } = useLoad(() => plan.prepareClose(storyKey));
  return (
    <LoadGate state={state} loadingText={CLOSE_TEXTS.loading} onRetry={retry} onBack={onBack}>
      {(preview) => <CloseBody preview={preview} storyKey={storyKey} plan={plan} onBack={onBack} />}
    </LoadGate>
  );
}

type Step = { name: 'confirm' } | { name: 'working' } | { name: 'done'; result: CloseResult };

function CloseBody({ preview, storyKey, plan, onBack }: CloseScreenProps & { preview: ClosePreview }) {
  const [step, setStep] = useState<Step>({ name: 'confirm' });
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setStep({ name: 'working' });
    try {
      const result = await plan.close(
        storyKey,
        preview.deletable.map((d) => d.file),
      );
      setStep({ name: 'done', result });
    } catch (err: unknown) {
      setError(CLOSE_TEXTS.closeError((err as Error).message));
      setStep({ name: 'confirm' });
    }
  };

  // Solo la confirmación explícita borra: cualquier otra tecla cancela
  useInput(
    (input, key) => {
      if (step.name === 'done') {
        if (key.escape) onBack();
      } else if (input.toLowerCase() === KEYS.confirmYes) void confirm();
      else onBack();
    },
    { isActive: step.name !== 'working' },
  );

  if (step.name === 'working') return <Text>{CLOSE_TEXTS.working}</Text>;
  if (step.name === 'done') {
    return (
      <Box flexDirection="column">
        <Text bold color={COLORS.accent}>
          {CLOSE_TEXTS.doneTitle}
        </Text>
        <Text>{CLOSE_TEXTS.doneDeleted(step.result.deleted.length)}</Text>
        <Text>{CLOSE_TEXTS.doneKept(step.result.kept.length)}</Text>
        <Text color={COLORS.muted}>{CLOSE_TEXTS.doneNextStep}</Text>
        <Text color={COLORS.muted}>{FOOTER_HINTS.closed}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {CLOSE_TEXTS.title(storyKey)}
      </Text>
      <Text bold>{CLOSE_TEXTS.deleteHeader}</Text>
      {preview.deletable.length === 0 && <Text>{CLOSE_TEXTS.nothing}</Text>}
      {preview.deletable.map((d) => (
        <Text key={d.file}>{CLOSE_TEXTS.fileLine(d.file, d.reason)}</Text>
      ))}
      <Text bold>{CLOSE_TEXTS.keepHeader}</Text>
      {preview.kept.length === 0 && <Text>{CLOSE_TEXTS.nothing}</Text>}
      {preview.kept.map((k) => (
        <Text key={k.file} color={COLORS.code}>
          {CLOSE_TEXTS.fileLine(k.file, k.reason)}
        </Text>
      ))}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text>{CLOSE_TEXTS.question}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.close}</Text>
    </Box>
  );
}
