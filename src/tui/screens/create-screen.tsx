import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  AssigneeView,
  CreateOutcome,
  CreatePreview,
  CreateProgress,
  CreationTarget,
  ExistingMatch,
  ParentOutcome,
  PlanBridge,
} from '../../refinement/review-types.js';
import { formatDuration } from '../components/duration.js';
import { LoadGate } from '../components/load-gate.js';
import { ManualKeyInput } from '../components/manual-key-input.js';
import { PickerList } from '../components/picker-list.js';
import { useLoad } from '../components/use-load.js';
import {
  COLORS,
  CREATE_TEXTS,
  FOOTER_HINTS,
  HOME_TEXTS,
  KEYS,
  PROGRESS_VISIBLE_LINES,
  PURPOSE_LABELS,
} from '../texts.js';

interface CreateScreenProps {
  storyKey: string;
  plan: PlanBridge;
  onBack: () => void;
  onFinished: () => void;
}

export function CreateScreen({ storyKey, plan, onBack, onFinished }: CreateScreenProps) {
  const { state, retry } = useLoad(() => plan.prepareCreate(storyKey));
  return (
    <LoadGate state={state} loadingText={CREATE_TEXTS.loading} onRetry={retry} onBack={onBack}>
      {(preview) => (
        <CreateFlow preview={preview} storyKey={storyKey} plan={plan} onBack={onBack} onFinished={onFinished} />
      )}
    </LoadGate>
  );
}

type Step =
  | { name: 'ask' }
  | { name: 'other' }
  | { name: 'confirm' }
  | { name: 'assignee' }
  | { name: 'running'; attempt: number }
  | { name: 'result'; outcome: CreateOutcome; attempt: number };

interface CreateFlowProps {
  preview: CreatePreview;
  storyKey: string;
  plan: PlanBridge;
  onBack: () => void;
  onFinished: () => void;
}

function CreateFlow({ preview, storyKey, plan, onBack, onFinished }: CreateFlowProps) {
  const [target, setTarget] = useState<CreationTarget | null>(
    preview.parent.kind === 'ready' ? preview.parent.target : null,
  );
  const [assignee, setAssignee] = useState<AssigneeView>(preview.assignee);
  const [step, setStep] = useState<Step>(target ? { name: 'confirm' } : { name: 'ask' });
  const [existing, setExisting] = useState<ExistingMatch[]>(preview.existing);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const chooseTarget = async (parentKey: string) => {
    setChecking(true);
    setTargetError(null);
    const result = await plan.resolveTarget(parentKey);
    setChecking(false);
    if (result.ok) {
      try {
        setExisting(await plan.findExisting(storyKey, result.target));
      } catch (err: unknown) {
        setTargetError(CREATE_TEXTS.otherError((err as Error).message));
        setStep({ name: 'ask' });
        return;
      }
      setTarget(result.target);
      setStep({ name: 'confirm' });
    } else {
      setTargetError(CREATE_TEXTS.otherError(result.message));
      setStep({ name: 'ask' });
    }
  };

  if (step.name === 'ask' && preview.parent.kind === 'ask') {
    return (
      <AskTarget
        parent={preview.parent}
        storyKey={storyKey}
        error={targetError}
        checking={checking}
        onEpic={(epicKey) => void chooseTarget(epicKey)}
        onOther={() => setStep({ name: 'other' })}
        onCancel={onBack}
      />
    );
  }
  if (step.name === 'other') {
    return <ManualKeyInput onSubmit={(key) => void chooseTarget(key)} onCancel={() => setStep({ name: 'ask' })} />;
  }
  if (step.name === 'assignee') {
    return (
      <AssigneePicker
        storyKey={storyKey}
        plan={plan}
        onPick={(picked) => {
          setAssignee(picked);
          setStep({ name: 'confirm' });
        }}
        onBack={() => setStep({ name: 'confirm' })}
      />
    );
  }
  if (step.name === 'running' && target) {
    return (
      <Running
        key={step.attempt}
        storyKey={storyKey}
        plan={plan}
        target={target}
        assignee={assignee}
        existing={existing}
        onFinished={(outcome) => setStep({ name: 'result', outcome, attempt: step.attempt })}
      />
    );
  }
  if (step.name === 'result' && target) {
    return (
      <Result
        outcome={step.outcome}
        plan={plan}
        onRetry={() => setStep({ name: 'running', attempt: step.attempt + 1 })}
        onBack={onBack}
        onFinished={onFinished}
      />
    );
  }
  if (target) {
    return (
      <Confirm
        preview={preview}
        target={target}
        assignee={assignee}
        existing={existing}
        onConfirm={() => setStep({ name: 'running', attempt: 0 })}
        onChangeAssignee={() => setStep({ name: 'assignee' })}
        onCancel={onBack}
      />
    );
  }
  return null;
}

type AskParent = Extract<ParentOutcome, { kind: 'ask' }>;
type AskChoice = 'epic' | 'other' | 'cancel';

function AskTarget({
  parent,
  storyKey,
  error,
  checking,
  onEpic,
  onOther,
  onCancel,
}: {
  parent: AskParent;
  storyKey: string;
  error: string | null;
  checking: boolean;
  onEpic: (epicKey: string) => void;
  onOther: () => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const options: Array<{ id: AskChoice; label: string }> = [
    ...(parent.epicKey
      ? [{ id: 'epic' as const, label: CREATE_TEXTS.askEpic(parent.epicKey, parent.epicSummary) }]
      : []),
    { id: 'other', label: CREATE_TEXTS.askOther },
    { id: 'cancel', label: CREATE_TEXTS.askCancel },
  ];

  useInput(
    (_input, key) => {
      if (key.escape) onCancel();
      else if (key.upArrow) setCursor((i) => Math.max(0, i - 1));
      else if (key.downArrow) setCursor((i) => Math.min(options.length - 1, i + 1));
      else if (key.return) {
        const choice = options[cursor].id;
        if (choice === 'epic' && parent.epicKey) onEpic(parent.epicKey);
        else if (choice === 'other') onOther();
        else onCancel();
      }
    },
    { isActive: !checking },
  );

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {CREATE_TEXTS.title}
      </Text>
      <Text>{CREATE_TEXTS.askReasons[parent.reason](storyKey)}</Text>
      <Text>{CREATE_TEXTS.askQuestion}</Text>
      {options.map((option, index) => (
        <Text key={option.id} color={index === cursor ? COLORS.brand : undefined}>
          {index === cursor ? HOME_TEXTS.selectedMarker : ' '} {option.label}
        </Text>
      ))}
      {checking && <Text>{CREATE_TEXTS.otherChecking}</Text>}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{FOOTER_HINTS.createAsk}</Text>
    </Box>
  );
}

function Confirm({
  preview,
  target,
  assignee,
  existing,
  onConfirm,
  onChangeAssignee,
  onCancel,
}: {
  preview: CreatePreview;
  target: CreationTarget;
  assignee: AssigneeView;
  existing: ExistingMatch[];
  onConfirm: () => void;
  onChangeAssignee: () => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    const answer = input.toLowerCase();
    if (answer === KEYS.confirmYes || answer === KEYS.confirmYesAlt) onConfirm();
    else if (answer === KEYS.changeAssignee) onChangeAssignee();
    else if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {CREATE_TEXTS.confirmTitle}
      </Text>
      <Text>{CREATE_TEXTS.tasks(preview.taskCount, formatDuration(preview.expectedSeconds))}</Text>
      <Text>{CREATE_TEXTS.parent(target.parentKey, target.parentSummary)}</Text>
      <Text>{CREATE_TEXTS.type(target.issueTypeName)}</Text>
      <Text>{CREATE_TEXTS.assignee(assignee.displayName)}</Text>
      <Text>{CREATE_TEXTS.uploads(preview.uploads.length)}</Text>
      {preview.uploads.map((u) => (
        <Text key={u.file} color={COLORS.muted}>
          {CREATE_TEXTS.uploadLine(u.file, PURPOSE_LABELS[u.purpose], u.taskIds.join(', '))}
        </Text>
      ))}
      {existing.length > 0 && (
        <>
          <Text color={COLORS.code}>{CREATE_TEXTS.existingHeader}</Text>
          {existing.map((m) => (
            <Text key={m.taskId} color={COLORS.code}>
              {CREATE_TEXTS.existingLine(m.key, m.summary)}
            </Text>
          ))}
        </>
      )}
      <Text color={COLORS.muted}>{CREATE_TEXTS.confirmNextStep}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.createConfirm}</Text>
    </Box>
  );
}

function AssigneePicker({
  storyKey,
  plan,
  onPick,
  onBack,
}: {
  storyKey: string;
  plan: PlanBridge;
  onPick: (assignee: AssigneeView) => void;
  onBack: () => void;
}) {
  const { state, retry } = useLoad(() => plan.listAssignees(storyKey));
  return (
    <LoadGate state={state} loadingText={CREATE_TEXTS.assigneeLoading} onRetry={retry} onBack={onBack}>
      {(users) => (
        <PickerList
          title={CREATE_TEXTS.assigneeTitle}
          items={users.map((u) => ({ id: u.accountId, label: u.displayName }))}
          nextStep={CREATE_TEXTS.confirmNextStep}
          hint={FOOTER_HINTS.assignee}
          onSelect={(id) => {
            const picked = users.find((u) => u.accountId === id);
            if (picked) onPick(picked);
          }}
          onBack={onBack}
        />
      )}
    </LoadGate>
  );
}

function Running({
  storyKey,
  plan,
  target,
  assignee,
  existing,
  onFinished,
}: {
  storyKey: string;
  plan: PlanBridge;
  target: CreationTarget;
  assignee: AssigneeView;
  existing: ExistingMatch[];
  onFinished: (outcome: CreateOutcome) => void;
}) {
  const [lines, setLines] = useState<CreateProgress[]>([]);

  useEffect(() => {
    let cancelled = false;
    plan
      .create(storyKey, { target, assigneeId: assignee.accountId, adopt: Object.fromEntries(existing.map((m) => [m.taskId, m.key])) }, (progress) => {
        if (!cancelled) setLines((l) => [...l, progress]);
      })
      .then((outcome) => {
        if (!cancelled) onFinished(outcome);
      })
      .catch((err: unknown) => {
        if (!cancelled) onFinished({ ok: false, message: (err as Error).message, created: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {CREATE_TEXTS.title}
      </Text>
      {lines.slice(-PROGRESS_VISIBLE_LINES).map((p, index) => (
        <Text key={index}>
          {CREATE_TEXTS.line(
            p.index,
            p.total,
            p.detail ? `${p.summary} (${p.detail})` : p.summary,
            CREATE_TEXTS.progress[p.step],
          )}
        </Text>
      ))}
      <Text color={COLORS.muted}>{FOOTER_HINTS.createRunning}</Text>
    </Box>
  );
}

function Result({
  outcome,
  plan,
  onRetry,
  onBack,
  onFinished,
}: {
  outcome: CreateOutcome;
  plan: PlanBridge;
  onRetry: () => void;
  onBack: () => void;
  onFinished: () => void;
}) {
  const [openError, setOpenError] = useState<string | null>(null);

  useInput((input, key) => {
    if (outcome.ok) {
      if (key.escape) onFinished();
      else if (input === KEYS.open) {
        plan
          .openInBrowser(outcome.parentKey)
          .catch((err: unknown) => setOpenError(CREATE_TEXTS.openError((err as Error).message)));
      }
    } else if (input === KEYS.retry) onRetry();
    else if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column">
      <Text bold color={outcome.ok ? COLORS.accent : COLORS.error}>
        {outcome.ok ? CREATE_TEXTS.doneTitle : CREATE_TEXTS.failedTitle}
      </Text>
      {outcome.created.map((c) => (
        <Text key={c.taskId}>{CREATE_TEXTS.doneLine(c.key, c.summary, c.existing)}</Text>
      ))}
      {outcome.ok ? (
        <>
          {outcome.estimateSkipped && <Text color={COLORS.code}>{CREATE_TEXTS.estimateSkipped}</Text>}
          {openError && <Text color={COLORS.error}>{openError}</Text>}
          <Text color={COLORS.muted}>{CREATE_TEXTS.doneNextStep(outcome.parentKey)}</Text>
          <Text color={COLORS.muted}>{FOOTER_HINTS.createDone}</Text>
        </>
      ) : (
        <>
          <Text color={COLORS.error}>{outcome.message}</Text>
          <Text>{CREATE_TEXTS.failedKept(outcome.created.length)}</Text>
          <Text color={COLORS.muted}>{CREATE_TEXTS.failedNextStep}</Text>
          <Text color={COLORS.muted}>{FOOTER_HINTS.createFailed}</Text>
        </>
      )}
    </Box>
  );
}
