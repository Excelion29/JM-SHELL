import React, { useState } from 'react';
import { Text } from 'ink';
import type { TaskFinishTarget, TasksBridge } from '../../refinement/tasks-types.js';
import { OptionSelector } from '../components/option-selector.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { FINISH_TEXTS } from '../texts.js';

interface TaskFinishScreenProps {
  target: TaskFinishTarget;
  tasks: TasksBridge;
  // Termina el flujo con un aviso para el inicio
  onDone: (notice: string) => void;
}

type Step = { name: 'ask' } | { name: 'busy' } | { name: 'choose'; available: string[] };

// Al volver de Claude: ¿terminaste? sí => Finalizada (sin tocar la estimación); no => sigue En curso
export function TaskFinishScreen({ target, tasks, onDone }: TaskFinishScreenProps) {
  const [step, setStep] = useState<Step>({ name: 'ask' });
  const { issueKey } = target;

  const finish = async (transitionName?: string) => {
    setStep({ name: 'busy' });
    try {
      const outcome = await tasks.finish(target, { transitionName });
      if (outcome.kind === 'ok') onDone(FINISH_TEXTS.done(issueKey));
      else if (outcome.kind === 'choose') setStep({ name: 'choose', available: outcome.available });
      else onDone(FINISH_TEXTS.failed(outcome.kind === 'failed' ? outcome.message : issueKey));
    } catch (err: unknown) {
      onDone(FINISH_TEXTS.failed((err as Error).message));
    }
  };

  if (step.name === 'busy') return <Text>{FINISH_TEXTS.working}</Text>;
  if (step.name === 'choose') {
    return (
      <OptionSelector
        title={FINISH_TEXTS.chooseTransition(issueKey)}
        options={step.available}
        onSelect={(name) => void finish(name)}
        onCancel={() => onDone(FINISH_TEXTS.keptInProgress(issueKey))}
      />
    );
  }
  return (
    <YesNoPrompt
      question={FINISH_TEXTS.question(issueKey)}
      onYes={() => void finish()}
      onNo={() => onDone(FINISH_TEXTS.keptInProgress(issueKey))}
    />
  );
}
