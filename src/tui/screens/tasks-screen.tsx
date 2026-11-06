import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PlanBridge } from '../../refinement/review-types.js';
import type { DeleteResult, TaskRow, TasksBridge, TasksModel } from '../../refinement/tasks-types.js';
import { LoadGate } from '../components/load-gate.js';
import { OptionSelector } from '../components/option-selector.js';
import { TypedConfirm, YesNoPrompt } from '../components/task-prompts.js';
import { buildRowCells, joinCells, summaryLine, visibleRows } from '../components/tasks-table.js';
import { useTerminalSize } from '../components/terminal-size.js';
import { useLoad } from '../components/use-load.js';
import {
  CHAT_DEFAULT_TERMINAL_COLUMNS,
  CHAT_DEFAULT_TERMINAL_ROWS,
  COLORS,
  FOOTER_HINTS,
  FRAME_HORIZONTAL_OVERHEAD,
  HOME_TEXTS,
  KEYS,
  REVIEW_CHROME_ROWS,
  REVIEW_MIN_VISIBLE_ROWS,
  TASKS_TEXTS,
} from '../texts.js';
import { PlanScreen } from './plan-screen.js';

interface TasksScreenProps {
  storyKey: string;
  tasks: TasksBridge;
  plan: PlanBridge;
  onBack: () => void;
  // La app se desmonta, abre Claude completo con la tarea y vuelve
  onRunTask: (storyKey: string | null, issueKey: string) => void;
}

export function TasksScreen(props: TasksScreenProps) {
  const { state, retry } = useLoad(() => props.tasks.load(props.storyKey));
  return (
    <LoadGate state={state} loadingText={TASKS_TEXTS.loading} onRetry={retry} onBack={props.onBack}>
      {(model) => <TasksBody {...props} initial={model} />}
    </LoadGate>
  );
}

type Mode =
  | { name: 'list' }
  | { name: 'busy'; text: string }
  | { name: 'reopen'; key: string }
  | { name: 'choose'; key: string; available: string[] }
  | { name: 'giveBack'; key: string; options: string[] }
  | { name: 'delete'; keys: string[] }
  | { name: 'deleted'; results: DeleteResult[] }
  | { name: 'plan' };

interface Message {
  text: string;
  error: boolean;
}

// Lo que sigue a una acción: un aviso y, si no es la lista, la pantalla a la que pasa
interface Next {
  message?: Message;
  mode?: Mode;
}

const errorMessage = (text: string): Message => ({ text, error: true });
const infoMessage = (text: string): Message => ({ text, error: false });

function TasksBody({ initial, storyKey, tasks, plan, onBack, onRunTask }: TasksScreenProps & { initial: TasksModel }) {
  const [model, setModel] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [marked, setMarked] = useState<string[]>([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [mode, setMode] = useState<Mode>({ name: 'list' });
  const size = useTerminalSize();
  const available = (size.columns ?? CHAT_DEFAULT_TERMINAL_COLUMNS) - FRAME_HORIZONTAL_OVERHEAD;

  const rows = visibleRows(model.rows, pendingOnly);
  const current: TaskRow | undefined = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  const cells = useMemo(() => buildRowCells(rows, available), [rows, available]);

  const backToList = (next: Message | null = null) => {
    setMessage(next);
    setMode({ name: 'list' });
  };

  const run = async (text: string, action: () => Promise<Next>) => {
    setMode({ name: 'busy', text });
    try {
      const next = await action();
      setMessage(next.message ?? null);
      setMode(next.mode ?? { name: 'list' });
    } catch (err: unknown) {
      backToList(errorMessage(TASKS_TEXTS.actionError((err as Error).message)));
    }
  };

  const reload = async () => setModel(await tasks.load(storyKey));

  const start = (key: string, options: { reopen?: boolean; transitionName?: string } = {}) =>
    run(TASKS_TEXTS.starting(key), async () => {
      const outcome = await tasks.start(storyKey, key, options);
      if (outcome.kind === 'ok') {
        onRunTask(storyKey, key);
        return {};
      }
      if (outcome.kind === 'needs-reopen') return { mode: { name: 'reopen', key } };
      if (outcome.kind === 'choose') return { mode: { name: 'choose', key, available: outcome.available } };
      return { message: errorMessage(TASKS_TEXTS.actionError(outcome.message)) };
    });

  const toggleMark = (row: TaskRow) => {
    if (row.category === 'done') setMessage(errorMessage(TASKS_TEXTS.doneBlocked(row.key)));
    else if (row.category === 'indeterminate') setMessage(errorMessage(TASKS_TEXTS.inProgressBlocked(row.key)));
    else setMarked((keys) => (keys.includes(row.key) ? keys.filter((k) => k !== row.key) : [...keys, row.key]));
  };

  const openGiveBack = (row: TaskRow) =>
    run(TASKS_TEXTS.starting(row.key), async () => {
      return { mode: { name: 'giveBack', key: row.key, options: await tasks.returnOptions(row.key) } };
    });

  const refresh = () =>
    run(TASKS_TEXTS.loading, async () => {
      const retried = model.rows.some((row) => row.pendingDone) ? await tasks.retryPending(storyKey) : null;
      await reload();
      return retried ? { message: infoMessage(TASKS_TEXTS.retryDone(retried.finished.length, retried.failed.length)) } : {};
    });

  const confirmDelete = (keys: string[]) =>
    run(TASKS_TEXTS.deleting, async () => {
      const results = await tasks.remove(storyKey, keys);
      setMarked([]);
      await reload();
      return { mode: { name: 'deleted', results } };
    });

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(rows.length - 1, i + 1));
      else if (input === KEYS.toggle && current) toggleMark(current);
      else if (input === KEYS.start && current) void start(current.key);
      else if (input === KEYS.giveBack && current) void openGiveBack(current);
      else if (input === KEYS.pendingFilter) setPendingOnly((on) => !on);
      else if (input === KEYS.retry) void refresh();
      else if (input === KEYS.viewPlan) setMode({ name: 'plan' });
      else if (input === KEYS.open && current) {
        tasks
          .openInBrowser(current.key)
          .catch((err: unknown) => setMessage(errorMessage(TASKS_TEXTS.openError((err as Error).message))));
      } else if (input === KEYS.removeTasks) {
        if (marked.length === 0) setMessage(infoMessage(TASKS_TEXTS.nothingSelected));
        else setMode({ name: 'delete', keys: marked });
      }
    },
    { isActive: mode.name === 'list' },
  );

  if (mode.name === 'busy') return <Text>{mode.text}</Text>;
  if (mode.name === 'plan') {
    return (
      <PlanScreen
        storyKey={storyKey}
        plan={plan}
        readOnly
        onBack={() => setMode({ name: 'list' })}
        onFinished={() => setMode({ name: 'list' })}
      />
    );
  }
  if (mode.name === 'reopen') {
    return (
      <YesNoPrompt
        question={TASKS_TEXTS.reopenQuestion(mode.key)}
        onYes={() => void start(mode.key, { reopen: true })}
        onNo={() => backToList()}
      />
    );
  }
  if (mode.name === 'choose') {
    return (
      <OptionSelector
        title={TASKS_TEXTS.chooseTransition(mode.key)}
        options={mode.available}
        onSelect={(name) => void start(mode.key, { reopen: true, transitionName: name })}
        onCancel={() => backToList()}
      />
    );
  }
  if (mode.name === 'giveBack') {
    return (
      <OptionSelector
        title={TASKS_TEXTS.chooseReturn(mode.key)}
        options={mode.options}
        onSelect={(name) =>
          void run(TASKS_TEXTS.starting(mode.key), async () => {
            await tasks.returnTo(mode.key, name);
            await reload();
            return { message: infoMessage(TASKS_TEXTS.returned(mode.key, name)) };
          })
        }
        onCancel={() => backToList()}
      />
    );
  }
  if (mode.name === 'delete') {
    return (
      <DeleteConfirm
        rows={model.rows.filter((row) => mode.keys.includes(row.key))}
        onConfirm={() => void confirmDelete(mode.keys)}
        onMismatch={() => backToList(errorMessage(TASKS_TEXTS.deleteMismatch))}
        onCancel={() => backToList()}
      />
    );
  }
  if (mode.name === 'deleted') return <DeleteReport results={mode.results} onClose={() => backToList()} />;

  const visibleCount = Math.max(
    REVIEW_MIN_VISIBLE_ROWS,
    (size.rows ?? CHAT_DEFAULT_TERMINAL_ROWS) - REVIEW_CHROME_ROWS,
  );
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const first = Math.max(0, index - visibleCount + 1);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={COLORS.accent}>
        {TASKS_TEXTS.title(model.storyKey, model.summary)}
      </Text>
      {rows.length === 0 && <Text>{TASKS_TEXTS.empty}</Text>}
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {rows.slice(first, first + visibleCount).map((row, offset) => (
          <Text
            key={row.key}
            color={first + offset === index ? COLORS.brand : undefined}
            dimColor={row.category === 'done'}
            wrap="truncate-end"
          >
            {first + offset === index ? HOME_TEXTS.selectedMarker : ' '} {marked.includes(row.key) ? '[x]' : '[ ]'}{' '}
            {joinCells(cells[first + offset])}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        <Text bold>
          {summaryLine(model.rows)}
          {pendingOnly && <Text color={COLORS.code}>{` · ${TASKS_TEXTS.filterOn}`}</Text>}
        </Text>
        {message && <Text color={message.error ? COLORS.error : COLORS.accent}>{message.text}</Text>}
        <Text color={COLORS.muted}>{TASKS_TEXTS.nextStep}</Text>
        <Text color={COLORS.muted}>{FOOTER_HINTS.tasks}</Text>
      </Box>
    </Box>
  );
}

interface DeleteConfirmProps {
  rows: TaskRow[];
  onConfirm: () => void;
  onMismatch: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ rows, ...handlers }: DeleteConfirmProps) {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.code}>
        {TASKS_TEXTS.deleteTitle}
      </Text>
      {rows.map((row) => (
        <Text key={row.key}>
          {TASKS_TEXTS.deleteLine(row.key, row.title, row.status, row.assignee ?? TASKS_TEXTS.noAssignee)}
        </Text>
      ))}
      <TypedConfirm prompt={TASKS_TEXTS.deletePrompt} {...handlers} />
    </Box>
  );
}

function DeleteReport({ results, onClose }: { results: DeleteResult[]; onClose: () => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) onClose();
  });
  const failed = results.filter((r) => !r.ok);
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {TASKS_TEXTS.deleteDone(results.length - failed.length, failed.length)}
      </Text>
      {failed.map((r) => (
        <Text key={r.key} color={COLORS.error}>
          {TASKS_TEXTS.deleteFailLine(r.key, r.message ?? '')}
        </Text>
      ))}
      <Text color={COLORS.muted}>{FOOTER_HINTS.closed}</Text>
    </Box>
  );
}
