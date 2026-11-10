import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { AnalysisPointsBridge, PointRow, PointsModel } from '../../refinement/analysis-types.js';
import { formatDuration } from '../components/duration.js';
import { LoadGate } from '../components/load-gate.js';
import { OptionSelector } from '../components/option-selector.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { useLoad } from '../components/use-load.js';
import { COLORS, FOOTER_HINTS, HOME_TEXTS, KEYS, POINTS_TEXTS as T } from '../texts.js';

interface AnalysisPointsScreenProps {
  id: string;
  points: AnalysisPointsBridge;
  // Punto que se acaba de trabajar en Claude: se pregunta si terminó antes de mostrar la lista
  askFinish: string | null;
  // La app se desmonta, abre Claude con el punto y vuelve
  onRunPoint: (id: string, pointId: string) => void;
  onBack: () => void;
}

export function AnalysisPointsScreen(props: AnalysisPointsScreenProps) {
  const { state, retry } = useLoad(() => props.points.load(props.id));
  return (
    <LoadGate state={state} loadingText={T.loading} onRetry={retry} onBack={props.onBack}>
      {(model) => <PointsBody {...props} initial={model} />}
    </LoadGate>
  );
}

type Mode =
  | { name: 'list' }
  | { name: 'busy' }
  | { name: 'reopen'; pointId: string }
  | { name: 'finishAsk'; pointId: string }
  | { name: 'returnPick'; pointId: string; options: string[] }
  | { name: 'chooseTransition'; pointId: string; kind: 'start' | 'done'; available: string[] };

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

const estimateText = (row: PointRow): string =>
  row.estimateSeconds === null ? T.noEstimate : formatDuration(row.estimateSeconds);

const realText = (row: PointRow): string =>
  row.realClaudeSeconds === null || row.realElapsedSeconds === null
    ? T.noReal
    : T.real(formatDuration(row.realClaudeSeconds), formatDuration(row.realElapsedSeconds));

const rowsOf = (model: PointsModel): PointRow[] => (model.kind === 'ready' ? model.rows : []);

function PointsBody({
  initial,
  id,
  points,
  askFinish,
  onRunPoint,
  onBack,
}: AnalysisPointsScreenProps & { initial: PointsModel }) {
  const [model, setModel] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState<Message | null>(null);
  const [mode, setMode] = useState<Mode>(askFinish ? { name: 'finishAsk', pointId: askFinish } : { name: 'list' });

  const rows = rowsOf(model);
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const current: PointRow | undefined = rows[index];

  const run = async (action: () => Promise<Next>) => {
    setMode({ name: 'busy' });
    try {
      const next = await action();
      setMessage(next.message ?? null);
      setMode(next.mode ?? { name: 'list' });
    } catch (err: unknown) {
      setMessage(errorMessage(T.actionError((err as Error).message)));
      setMode({ name: 'list' });
    }
  };

  const reload = async () => setModel(await points.load(id));

  const start = (pointId: string, reopen = false, transitionName?: string) =>
    run(async () => {
      const outcome = await points.start(id, pointId, { reopen, transitionName });
      if (outcome.kind === 'ok') {
        onRunPoint(id, pointId);
        return {};
      }
      if (outcome.kind === 'needs-reopen') return { mode: { name: 'reopen', pointId } };
      if (outcome.kind === 'choose') {
        return { mode: { name: 'chooseTransition', pointId, kind: 'start', available: outcome.available } };
      }
      return { message: errorMessage(T.actionError(outcome.message)) };
    });

  const refresh = () =>
    run(async () => {
      await reload();
      return {};
    });

  const finish = (pointId: string, transitionName?: string) =>
    run(async () => {
      const outcome = await points.finish(id, pointId, transitionName);
      await reload();
      if (outcome.choose) {
        return { mode: { name: 'chooseTransition', pointId, kind: 'done', available: outcome.choose } };
      }
      return { message: outcome.notice ? errorMessage(outcome.notice) : infoMessage(T.finished(pointId)) };
    });

  const giveBack = (pointId: string, transitionName?: string) =>
    run(async () => {
      const notice = await points.giveBack(id, pointId, transitionName);
      await reload();
      return { message: notice ? errorMessage(notice) : infoMessage(T.returned(pointId)) };
    });

  // Un punto vinculado pregunta a qué estado de Jira vuelve; si Jira no lo ofrece, solo se devuelve en jm
  const giveBackLinked = (row: PointRow) =>
    run(async () => {
      const options = await points.returnOptions(id, row.id);
      if (options.length > 0) return { mode: { name: 'returnPick', pointId: row.id, options } };
      await points.giveBack(id, row.id);
      await reload();
      return { message: errorMessage(T.jiraNotMoved(row.id)) };
    });

  const requestFinish = (row: PointRow) =>
    row.status === 'done' ? setMessage(infoMessage(T.alreadyDone(row.id))) : void finish(row.id);

  const requestGiveBack = (row: PointRow) => {
    if (row.status !== 'started') setMessage(errorMessage(T.notStarted(row.id)));
    else if (row.issueKey) void giveBackLinked(row);
    else void giveBack(row.id);
  };

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(rows.length - 1, i + 1));
      else if (input === KEYS.start && current) void start(current.id);
      else if (input === KEYS.finishDirect && current) requestFinish(current);
      else if (input === KEYS.giveBack && current) requestGiveBack(current);
      else if (input === KEYS.retry) void refresh();
    },
    { isActive: mode.name === 'list' },
  );

  if (mode.name === 'busy') return <Text>{T.working}</Text>;
  if (mode.name === 'reopen') {
    return (
      <YesNoPrompt
        question={T.reopenQuestion(mode.pointId)}
        onYes={() => void start(mode.pointId, true)}
        onNo={() => setMode({ name: 'list' })}
      />
    );
  }
  if (mode.name === 'returnPick') {
    return (
      <OptionSelector
        title={T.chooseReturn(mode.pointId)}
        options={mode.options}
        onSelect={(name) => void giveBack(mode.pointId, name)}
        onCancel={() => setMode({ name: 'list' })}
      />
    );
  }
  if (mode.name === 'chooseTransition') {
    return (
      <OptionSelector
        title={mode.kind === 'start' ? T.chooseStart : T.chooseDone}
        options={mode.available}
        onSelect={(name) => void (mode.kind === 'start' ? start(mode.pointId, false, name) : finish(mode.pointId, name))}
        onCancel={() => {
          setMessage(errorMessage(T.jiraNotMoved(mode.pointId)));
          setMode({ name: 'list' });
        }}
      />
    );
  }
  if (mode.name === 'finishAsk') {
    return (
      <YesNoPrompt
        question={T.finishQuestion(mode.pointId)}
        onYes={() => void finish(mode.pointId)}
        onNo={() => {
          setMessage(infoMessage(T.keptInProgress(mode.pointId)));
          setMode({ name: 'list' });
        }}
      />
    );
  }

  const done = rows.filter((row) => row.status === 'done').length;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={COLORS.accent}>
        {T.title(model.id, model.name)}
      </Text>
      <Body model={model} index={index} />
      {rows.length > 0 && <Text bold>{T.summary(done, rows.length)}</Text>}
      {message && <Text color={message.error ? COLORS.error : COLORS.accent}>{message.text}</Text>}
      <Text color={COLORS.muted}>{T.nextStep}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.points}</Text>
    </Box>
  );
}

function Body({ model, index }: { model: PointsModel; index: number }) {
  if (model.kind === 'missing') return <Text>{T.empty}</Text>;
  if (model.kind === 'invalid') return <Text color={COLORS.error}>{T.invalid(model.message)}</Text>;
  if (model.rows.length === 0) return <Text>{T.noneInScope}</Text>;
  return (
    <Box flexDirection="column">
      {model.rows.map((row, i) => (
        <Text
          key={row.id}
          color={i === index ? COLORS.brand : undefined}
          dimColor={row.status === 'done'}
          wrap="truncate-end"
        >
          {i === index ? HOME_TEXTS.selectedMarker : ' '}{' '}
          {T.line(row.id, T.status[row.status], row.title, estimateText(row), realText(row), row.issueKey)}
        </Text>
      ))}
    </Box>
  );
}
