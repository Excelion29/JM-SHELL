import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { MyDayModel, TasksBridge } from '../../refinement/tasks-types.js';
import { DirectFinishFlow, type DirectFinishItem, type DirectFinishResult } from '../components/direct-finish.js';
import { LoadGate } from '../components/load-gate.js';
import { formatDuration } from '../components/duration.js';
import { OptionSelector } from '../components/option-selector.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { buildMyDayCells, joinCells } from '../components/tasks-table.js';
import { useTerminalSize } from '../components/terminal-size.js';
import { useLoad } from '../components/use-load.js';
import {
  CHAT_DEFAULT_TERMINAL_COLUMNS,
  COLORS,
  FINISH_TEXTS,
  FOOTER_HINTS,
  FRAME_HORIZONTAL_OVERHEAD,
  HOME_TEXTS,
  KEYS,
  MY_DAY_TEXTS,
  TASKS_TEXTS,
} from '../texts.js';

interface MyDayScreenProps {
  tasks: TasksBridge;
  onBack: () => void;
  onRunTask: (storyKey: string | null, issueKey: string) => void;
}

export function MyDayScreen(props: MyDayScreenProps) {
  const { state, retry } = useLoad(() => props.tasks.myDay());
  return (
    <LoadGate state={state} loadingText={MY_DAY_TEXTS.loading} onRetry={retry} onBack={props.onBack}>
      {(model) => <MyDayBody {...props} model={model} onRefresh={retry} />}
    </LoadGate>
  );
}

type Mode =
  | { name: 'list' }
  | { name: 'busy' }
  | { name: 'finish'; item: DirectFinishItem }
  | { name: 'reopen'; key: string; parentKey: string | null }
  | { name: 'choose'; key: string; parentKey: string | null; available: string[] };

function MyDayBody({
  model,
  tasks,
  onBack,
  onRunTask,
  onRefresh,
}: MyDayScreenProps & { model: MyDayModel; onRefresh: () => void }) {
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  const [error, setError] = useState<string | null>(null);
  const size = useTerminalSize();
  const available = (size.columns ?? CHAT_DEFAULT_TERMINAL_COLUMNS) - FRAME_HORIZONTAL_OVERHEAD;
  const cells = useMemo(() => buildMyDayCells(model.rows, available), [model.rows, available]);
  const current = model.rows[selected];

  const start = async (
    key: string,
    parentKey: string | null,
    options: { reopen?: boolean; transitionName?: string },
  ) => {
    setMode({ name: 'busy' });
    setError(null);
    try {
      const outcome = await tasks.startMyDay(key, parentKey, options);
      if (outcome.kind === 'ok') onRunTask(outcome.storyKey, key);
      else if (outcome.kind === 'needs-reopen') return setMode({ name: 'reopen', key, parentKey });
      else if (outcome.kind === 'choose')
        return setMode({ name: 'choose', key, parentKey, available: outcome.available });
      else setError(TASKS_TEXTS.actionError(outcome.message));
    } catch (err: unknown) {
      setError(TASKS_TEXTS.actionError((err as Error).message));
    }
    setMode({ name: 'list' });
  };

  const openFinish = () => {
    if (!current) return;
    if (current.category === 'done') return setError(FINISH_TEXTS.directNothing);
    setError(null);
    setMode({
      name: 'finish',
      item: { storyKey: current.parentKey, issueKey: current.key, title: current.title, status: current.status },
    });
  };

  const closeFinish = (result: DirectFinishResult | null) => {
    setMode({ name: 'list' });
    if (!result) return;
    if (result.failed.length > 0) setError(FINISH_TEXTS.directSummary(result.done.length, result.failed));
    onRefresh();
  };

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      else if (input === KEYS.finishDirect) openFinish();
      else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(model.rows.length - 1, i + 1));
      else if (input === KEYS.retry) onRefresh();
      else if (input === KEYS.start && current) void start(current.key, current.parentKey, {});
      else if (input === KEYS.open && current) {
        tasks
          .openInBrowser(current.key)
          .catch((err: unknown) => setError(TASKS_TEXTS.openError((err as Error).message)));
      }
    },
    { isActive: mode.name === 'list' },
  );

  if (mode.name === 'busy') return <Text>{TASKS_TEXTS.starting(current?.key ?? '')}</Text>;
  if (mode.name === 'finish') {
    return (
      <DirectFinishFlow
        items={[mode.item]}
        finish={({ issueKey }, options) => tasks.finishMyDay(issueKey, mode.item.storyKey, options)}
        onClose={closeFinish}
      />
    );
  }
  if (mode.name === 'reopen') {
    return (
      <YesNoPrompt
        question={TASKS_TEXTS.reopenQuestion(mode.key)}
        onYes={() => void start(mode.key, mode.parentKey, { reopen: true })}
        onNo={() => setMode({ name: 'list' })}
      />
    );
  }
  if (mode.name === 'choose') {
    return (
      <OptionSelector
        title={TASKS_TEXTS.chooseTransition}
        options={mode.available}
        onSelect={(name) => void start(mode.key, mode.parentKey, { reopen: true, transitionName: name })}
        onCancel={() => setMode({ name: 'list' })}
      />
    );
  }

  const overCapacity = model.totalSeconds > model.capacitySeconds;
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {MY_DAY_TEXTS.title}
      </Text>
      {model.rows.length === 0 && <Text>{MY_DAY_TEXTS.empty}</Text>}
      {model.rows.map((row, index) => (
        <Text
          key={row.key}
          color={index === selected ? COLORS.brand : row.overdue ? COLORS.error : undefined}
          wrap="truncate-end"
        >
          {index === selected ? HOME_TEXTS.selectedMarker : ' '} {joinCells(cells[index])}
          {row.overdue ? ` · ${MY_DAY_TEXTS.overdue}` : ''}
        </Text>
      ))}
      <Text bold color={overCapacity ? COLORS.code : undefined}>
        {MY_DAY_TEXTS.total(formatDuration(model.totalSeconds), formatDuration(model.capacitySeconds))}
      </Text>
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{MY_DAY_TEXTS.nextStep}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.myDay}</Text>
    </Box>
  );
}
