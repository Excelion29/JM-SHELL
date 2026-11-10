import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { AnalysisLinkBridge, LinkModel, LinkPointResult, PointRow } from '../../refinement/analysis-types.js';
import type { BrowseItem } from '../../refinement/types.js';
import { formatDuration } from '../components/duration.js';
import { EpicPicker } from '../components/epic-picker.js';
import { LoadGate } from '../components/load-gate.js';
import { ManualKeyInput } from '../components/manual-key-input.js';
import { YesNoPrompt } from '../components/task-prompts.js';
import { useLoad } from '../components/use-load.js';
import { COLORS, FOOTER_HINTS, HOME_TEXTS, KEYS, LINK_TEXTS as T, POINTS_TEXTS } from '../texts.js';
import { EpicKept, LinkResult, TargetPicker } from './analysis-link-parts.js';

interface AnalysisLinkScreenProps {
  id: string;
  link: AnalysisLinkBridge;
  fetchEpics: () => Promise<BrowseItem[]>;
  fetchStories: (epicKey: string | null) => Promise<BrowseItem[]>;
  // Vuelve al inicio, con un aviso si se creó algo
  onDone: (notice: string | null) => void;
}

export function AnalysisLinkScreen(props: AnalysisLinkScreenProps) {
  const { state, retry } = useLoad(() => props.link.load(props.id));
  return (
    <LoadGate state={state} loadingText={T.loading} onRetry={retry} onBack={() => props.onDone(null)}>
      {(model) => <LinkFlow {...props} model={model} />}
    </LoadGate>
  );
}

type ChildKind = 'standard' | 'subtask';

// Destino elegido para un punto aún sin crear
interface Target {
  key: string;
  childKind: ChildKind;
}

type Step =
  | { name: 'epicKept' }
  | { name: 'epic' }
  | { name: 'epicManual' }
  | { name: 'busy'; text: string }
  | { name: 'points' }
  | { name: 'target' }
  | { name: 'targetManual' }
  | { name: 'confirm' }
  | { name: 'result'; results: LinkPointResult[] };

interface Message {
  text: string;
  error: boolean;
}

const errorMessage = (text: string): Message => ({ text, error: true });
const infoMessage = (text: string): Message => ({ text, error: false });

const rowsOf = (model: LinkModel): PointRow[] => (model.points.kind === 'ready' ? model.points.rows : []);

function firstStep(model: LinkModel): Step {
  if (rowsOf(model).length === 0) return { name: 'points' };
  return { name: model.epicKey ? 'epicKept' : 'epic' };
}

const estimateText = (row: PointRow): string =>
  row.estimateSeconds === null ? POINTS_TEXTS.noEstimate : formatDuration(row.estimateSeconds);

function LinkFlow({ model, id, link, fetchEpics, fetchStories, onDone }: AnalysisLinkScreenProps & { model: LinkModel }) {
  const [step, setStep] = useState<Step>(() => firstStep(model));
  const [epicKey, setEpicKey] = useState(model.epicKey);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [marked, setMarked] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState<Message | null>(null);

  const rows = rowsOf(model);
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const current: PointRow | undefined = rows[index];
  const epicTarget: Target | null = epicKey ? { key: epicKey, childKind: 'standard' } : null;
  const targetOf = (row: PointRow): Target | null => (row.issueKey ? null : (targets[row.id] ?? epicTarget));
  const toCreate = rows.filter((row) => targetOf(row) !== null);

  const run = async (text: string, action: () => Promise<Step>) => {
    setStep({ name: 'busy', text });
    try {
      setStep(await action());
    } catch (err: unknown) {
      setMessage(errorMessage(T.actionError((err as Error).message)));
      setStep({ name: 'points' });
    }
  };

  const chooseEpic = (key: string) =>
    run(T.checking(key), async () => {
      const outcome = await link.resolveTarget(id, key, true);
      if (!outcome.ok) {
        setMessage(errorMessage(T.refused(outcome.message)));
        return { name: 'epic' };
      }
      await link.setEpic(id, key);
      setEpicKey(key);
      setMessage(infoMessage(T.epicSaved(key)));
      return { name: 'points' };
    });

  const applyTarget = (target: Target) => {
    setTargets((all) => ({ ...all, ...Object.fromEntries(marked.map((pointId) => [pointId, target])) }));
    setMessage(infoMessage(T.targetSet(marked.length, target.key)));
    setMarked([]);
    setStep({ name: 'points' });
  };

  const chooseManualTarget = (key: string) =>
    run(T.checking(key), async () => {
      const outcome = await link.resolveTarget(id, key, false);
      if (!outcome.ok) {
        setMessage(errorMessage(T.refused(outcome.message)));
        return { name: 'points' };
      }
      applyTarget({ key: outcome.target.key, childKind: outcome.target.childKind });
      return { name: 'points' };
    });

  const createAll = () =>
    run(T.creating, async () => {
      const wanted = Object.fromEntries(toCreate.map((row) => [row.id, (targetOf(row) as Target).key]));
      return { name: 'result', results: await link.create(id, wanted) };
    });

  const toggleMark = (row: PointRow) => {
    if (row.issueKey) setMessage(infoMessage(T.fixed));
    else setMarked((ids) => (ids.includes(row.id) ? ids.filter((pointId) => pointId !== row.id) : [...ids, row.id]));
  };

  const chooseTargets = () => {
    if (marked.length === 0) setMessage(errorMessage(T.nothingMarked));
    else setStep({ name: 'target' });
  };

  const confirm = () => {
    if (toCreate.length === 0) setMessage(errorMessage(T.nothingToCreate));
    else setStep({ name: 'confirm' });
  };

  useInput(
    (input, key) => {
      if (key.escape) onDone(null);
      else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(rows.length - 1, i + 1));
      else if (input === KEYS.toggle && current) toggleMark(current);
      else if (input === KEYS.edit) chooseTargets();
      else if (input === KEYS.create) confirm();
    },
    { isActive: step.name === 'points' },
  );

  if (step.name === 'busy') return <Text>{step.text}</Text>;
  if (step.name === 'epicKept' && epicKey) {
    return (
      <EpicKept
        epicKey={epicKey}
        onKeep={() => setStep({ name: 'points' })}
        onChange={() => setStep({ name: 'epic' })}
        onBack={() => onDone(null)}
      />
    );
  }
  if (step.name === 'epic') {
    return (
      <Box flexDirection="column">
        {message?.error && <Text color={COLORS.error}>{message.text}</Text>}
        <EpicPicker
          texts={{ title: T.epicTitle, empty: T.epicEmpty, nextStep: T.epicNextStep, hint: FOOTER_HINTS.linkPicker }}
          fetchEpics={fetchEpics}
          onChoose={(key) => void chooseEpic(key)}
          onManual={() => setStep({ name: 'epicManual' })}
          onBack={() => setStep({ name: 'points' })}
        />
      </Box>
    );
  }
  if (step.name === 'epicManual') {
    return <ManualKeyInput onSubmit={(key) => void chooseEpic(key)} onCancel={() => setStep({ name: 'epic' })} />;
  }
  if (step.name === 'target') {
    return (
      <TargetPicker
        epicKey={epicKey}
        fetchStories={fetchStories}
        onChoose={(key, isEpic) => applyTarget({ key, childKind: isEpic ? 'standard' : 'subtask' })}
        onManual={() => setStep({ name: 'targetManual' })}
        onBack={() => setStep({ name: 'points' })}
      />
    );
  }
  if (step.name === 'targetManual') {
    return <ManualKeyInput onSubmit={(key) => void chooseManualTarget(key)} onCancel={() => setStep({ name: 'points' })} />;
  }
  if (step.name === 'confirm') {
    const skipped = rows.filter((row) => !row.issueKey && targetOf(row) === null).map((row) => row.id);
    return (
      <Box flexDirection="column">
        <Text bold color={COLORS.accent}>
          {T.confirmTitle}
        </Text>
        {groupLines(toCreate, targetOf).map((line) => (
          <Text key={line}>{line}</Text>
        ))}
        {skipped.length > 0 && <Text color={COLORS.muted}>{T.skipped(skipped.join(', '))}</Text>}
        <YesNoPrompt question={T.confirm} onYes={() => void createAll()} onNo={() => setStep({ name: 'points' })} />
      </Box>
    );
  }
  if (step.name === 'result') return <LinkResult results={step.results} onBack={() => onDone(resultNotice(step.results))} />;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={COLORS.accent}>
        {POINTS_TEXTS.title(model.points.id, model.points.name)}
      </Text>
      {epicKey && <Text>{T.epicCurrent(epicKey)}</Text>}
      {rows.length === 0 && <Text>{T.noPoints}</Text>}
      {rows.map((row, i) => (
        <Text key={row.id} color={i === index ? COLORS.brand : undefined} wrap="truncate-end">
          {i === index ? HOME_TEXTS.selectedMarker : ' '} {marked.includes(row.id) ? '[x]' : '[ ]'}{' '}
          {T.line(row.id, row.title, estimateText(row), POINTS_TEXTS.status[row.status], destinationText(row, targetOf(row)))}
        </Text>
      ))}
      {message && <Text color={message.error ? COLORS.error : COLORS.accent}>{message.text}</Text>}
      <Text color={COLORS.muted}>{FOOTER_HINTS.linkPoints}</Text>
    </Box>
  );
}

const destinationText = (row: PointRow, target: Target | null): string =>
  row.issueKey ?? target?.key ?? T.noTarget;

// "P1, P2 → PM-2120 (subtareas) · P3 → PM-2117 (tareas)", uno por destino
function groupLines(rows: PointRow[], targetOf: (row: PointRow) => Target | null): string[] {
  const groups = new Map<string, { childKind: ChildKind; ids: string[] }>();
  for (const row of rows) {
    const target = targetOf(row) as Target;
    const group = groups.get(target.key) ?? { childKind: target.childKind, ids: [] };
    group.ids.push(row.id);
    groups.set(target.key, group);
  }
  return [...groups].map(([key, group]) => T.group(group.ids.join(', '), key, group.childKind));
}

function resultNotice(results: LinkPointResult[]): string {
  const created = results.filter((result) => result.ok).length;
  return T.summary(created, results.length - created);
}
