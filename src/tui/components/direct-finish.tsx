import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { TaskFinishTarget, TransitionOptions, TransitionOutcome } from '../../refinement/tasks-types.js';
import { COLORS, FINISH_TEXTS } from '../texts.js';
import { OptionSelector } from './option-selector.js';
import { YesNoPrompt } from './task-prompts.js';

export interface DirectFinishItem extends TaskFinishTarget {
  title: string;
  status: string;
}

export interface DirectFinishResult {
  done: string[];
  failed: string[];
}

interface DirectFinishFlowProps {
  items: DirectFinishItem[];
  finish: (target: TaskFinishTarget, options: TransitionOptions) => Promise<TransitionOutcome>;
  onClose: (result: DirectFinishResult | null) => void;
}

interface Choice {
  key: string;
  available: string[];
}

const DIRECT: TransitionOptions = { direct: true };

// Un error en una tarea se anota y no corta las demás
async function finishOne(
  props: DirectFinishFlowProps,
  item: DirectFinishItem,
  choose: (choice: Choice) => Promise<string | null>,
): Promise<string | null> {
  const target = { storyKey: item.storyKey, issueKey: item.issueKey };
  try {
    let outcome = await props.finish(target, DIRECT);
    if (outcome.kind === 'choose') {
      const name = await choose({ key: item.issueKey, available: outcome.available });
      if (name === null) return `${item.issueKey}: ${FINISH_TEXTS.directCancelled}`;
      outcome = await props.finish(target, { ...DIRECT, transitionName: name });
    }
    if (outcome.kind === 'ok') return null;
    return `${item.issueKey}: ${outcome.kind === 'failed' ? outcome.message : FINISH_TEXTS.directCancelled}`;
  } catch (err: unknown) {
    return `${item.issueKey}: ${(err as Error).message}`;
  }
}

export function DirectFinishFlow(props: DirectFinishFlowProps) {
  const [phase, setPhase] = useState<'confirm' | 'working'>('confirm');
  const [current, setCurrent] = useState('');
  const [choice, setChoice] = useState<Choice | null>(null);
  const resolver = useRef<((name: string | null) => void) | null>(null);

  const ask = (next: Choice) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setChoice(next);
    });

  const answer = (name: string | null) => {
    setChoice(null);
    resolver.current?.(name);
  };

  const run = async () => {
    setPhase('working');
    const result: DirectFinishResult = { done: [], failed: [] };
    for (const item of props.items) {
      setCurrent(item.issueKey);
      const failure = await finishOne(props, item, ask);
      if (failure === null) result.done.push(item.issueKey);
      else result.failed.push(failure);
    }
    props.onClose(result);
  };

  // Desmontada la pantalla, un selector pendiente se resuelve como cancelado
  useEffect(() => () => resolver.current?.(null), []);

  if (choice) {
    return (
      <OptionSelector
        title={FINISH_TEXTS.chooseTransition}
        options={choice.available}
        onSelect={answer}
        onCancel={() => answer(null)}
      />
    );
  }
  if (phase === 'working') return <Text>{FINISH_TEXTS.directWorking(current)}</Text>;
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.code}>
        {FINISH_TEXTS.directTitle}
      </Text>
      {props.items.map((item) => (
        <Text key={item.issueKey}>{FINISH_TEXTS.directLine(item.issueKey, item.title, item.status)}</Text>
      ))}
      <YesNoPrompt question={FINISH_TEXTS.directQuestion} onYes={() => void run()} onNo={() => props.onClose(null)} />
    </Box>
  );
}
