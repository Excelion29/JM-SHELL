import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PlanBridge, ReviewModel, ReviewTask } from '../../refinement/review-types.js';
import { AttachmentsView } from '../components/attachments-view.js';
import { formatDuration, truncate } from '../components/duration.js';
import { LoadGate } from '../components/load-gate.js';
import { TaskEditForm } from '../components/task-edit-form.js';
import { useLoad } from '../components/use-load.js';
import {
  COLORS,
  FOOTER_HINTS,
  HOME_TEXTS,
  KEYS,
  PLAN_TEXTS,
  PURPOSE_LABELS,
  RISK_COLORS,
  RISK_LABELS,
  SUMMARY_MAX_CHARS,
} from '../texts.js';
import { CreateScreen } from './create-screen.js';

interface PlanScreenProps {
  storyKey: string;
  plan: PlanBridge;
  onBack: () => void;
  // La historia ya quedó creada: la app vuelve al inicio y recarga
  onFinished: () => void;
}

export function PlanScreen({ storyKey, plan, onBack, onFinished }: PlanScreenProps) {
  const { state, retry } = useLoad(() => plan.load(storyKey));
  return (
    <LoadGate state={state} loadingText={PLAN_TEXTS.loading} onRetry={retry} onBack={onBack}>
      {(model) => (
        <ReviewBody initial={model} storyKey={storyKey} plan={plan} onBack={onBack} onFinished={onFinished} />
      )}
    </LoadGate>
  );
}

type View =
  | { name: 'list' }
  | { name: 'edit'; taskId: string }
  | { name: 'detail'; taskId: string }
  | { name: 'files' }
  | { name: 'create' };

interface ReviewBodyProps {
  initial: ReviewModel;
  storyKey: string;
  plan: PlanBridge;
  onBack: () => void;
  onFinished: () => void;
}

function ReviewBody({ initial, storyKey, plan, onBack, onFinished }: ReviewBodyProps) {
  const [model, setModel] = useState(initial);
  const [view, setView] = useState<View>({ name: 'list' });
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Cada cambio se guarda al instante; si falla, la pantalla conserva lo último guardado
  const save = async (change: Promise<ReviewModel>): Promise<boolean> => {
    try {
      setModel(await change);
      setError(null);
      return true;
    } catch (err: unknown) {
      setError(PLAN_TEXTS.saveError((err as Error).message));
      return false;
    }
  };

  const current = model.tasks[selected];

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(model.tasks.length - 1, i + 1));
      else if (input === KEYS.toggle && current) {
        void save(plan.updateTask(storyKey, current.id, { include: !current.include }));
      } else if (input === KEYS.edit && current) setView({ name: 'edit', taskId: current.id });
      else if (input === KEYS.detail && current) setView({ name: 'detail', taskId: current.id });
      else if (input === KEYS.attachments) setView({ name: 'files' });
      else if (input === KEYS.create) {
        if (model.totals.taskCount === 0) setError(PLAN_TEXTS.noneIncluded);
        else setView({ name: 'create' });
      }
    },
    { isActive: view.name === 'list' },
  );

  const taskOf = (id: string) => model.tasks.find((t) => t.id === id);

  if (view.name === 'edit') {
    const task = taskOf(view.taskId);
    if (task) {
      return (
        <TaskEditForm
          task={task}
          previewEstimate={plan.previewEstimate}
          error={error}
          onSave={async (patch) => {
            if (await save(plan.updateTask(storyKey, task.id, patch))) setView({ name: 'list' });
          }}
          onCancel={() => {
            setError(null);
            setView({ name: 'list' });
          }}
        />
      );
    }
  }
  if (view.name === 'detail') {
    const task = taskOf(view.taskId);
    if (task) return <TaskDetail task={task} model={model} onBack={() => setView({ name: 'list' })} />;
  }
  if (view.name === 'files') {
    return (
      <AttachmentsView
        files={model.files}
        tasks={model.tasks}
        error={error}
        onCyclePurpose={(file, purpose) => void save(plan.setAttachmentPurpose(storyKey, file, purpose))}
        onToggleTask={(file, taskId) => void save(plan.toggleAttachmentTask(storyKey, file, taskId))}
        onOpen={(file) =>
          plan
            .openAttachment(storyKey, file)
            .catch((err: unknown) => setError(PLAN_TEXTS.openError((err as Error).message)))
        }
        onBack={() => {
          setError(null);
          setView({ name: 'list' });
        }}
      />
    );
  }
  if (view.name === 'create') {
    return (
      <CreateScreen storyKey={storyKey} plan={plan} onBack={() => setView({ name: 'list' })} onFinished={onFinished} />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {PLAN_TEXTS.title(model.storyKey, model.summary)}
      </Text>
      {model.tasks.length === 0 && <Text>{PLAN_TEXTS.empty}</Text>}
      {model.tasks.map((task, index) => (
        <TaskRow key={task.id} task={task} active={index === selected} />
      ))}
      <Text bold>
        {PLAN_TEXTS.total(
          model.totals.taskCount,
          formatDuration(model.totals.expectedSeconds),
          formatDuration(model.totals.stdDevSeconds),
        )}
      </Text>
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{PLAN_TEXTS.nextStep}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.review}</Text>
    </Box>
  );
}

function TaskRow({ task, active }: { task: ReviewTask; active: boolean }) {
  const { optimistic, likely, pessimistic } = task.estimate;
  return (
    <Text color={active ? COLORS.brand : undefined} dimColor={!task.include}>
      {active ? HOME_TEXTS.selectedMarker : ' '} {task.include ? PLAN_TEXTS.included : PLAN_TEXTS.excluded} {task.id}{' '}
      {truncate(task.summary, SUMMARY_MAX_CHARS)} · O {optimistic} M {likely} P {pessimistic} · ~
      {formatDuration(task.expectedSeconds)} · <Text color={RISK_COLORS[task.risk]}>{RISK_LABELS[task.risk]}</Text>
    </Text>
  );
}

function TaskDetail({ task, model, onBack }: { task: ReviewTask; model: ReviewModel; onBack: () => void }) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });
  const files = model.files.filter((f) => f.taskIds.includes(task.id));
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {PLAN_TEXTS.detailTitle(task.id, task.summary)}
      </Text>
      <Text bold>{PLAN_TEXTS.detailDescription}</Text>
      <Text>{task.description || PLAN_TEXTS.none}</Text>
      <Text bold>{PLAN_TEXTS.detailCriteria}</Text>
      {task.doneCriteria.length === 0 && <Text>{PLAN_TEXTS.none}</Text>}
      {task.doneCriteria.map((item, index) => (
        <Text key={index}>- {item}</Text>
      ))}
      <Text bold>{PLAN_TEXTS.detailRationale}</Text>
      <Text>{task.rationale || PLAN_TEXTS.none}</Text>
      <Text bold>{PLAN_TEXTS.detailAttachments}</Text>
      {files.length === 0 && <Text>{PLAN_TEXTS.none}</Text>}
      {files.map((f) => (
        <Text key={f.file}>
          - {f.file} ({PURPOSE_LABELS[f.purpose]})
        </Text>
      ))}
      <Text color={COLORS.muted}>{FOOTER_HINTS.detail}</Text>
    </Box>
  );
}
