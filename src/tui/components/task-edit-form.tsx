import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { EstimatePreview, ReviewTask, TaskPatch } from '../../refinement/review-types.js';
import { COLORS, FOOTER_HINTS, PLAN_TEXTS } from '../texts.js';
import { formatDuration } from './duration.js';

type Field = 'summary' | 'optimistic' | 'likely' | 'pessimistic';
const FIELD_ORDER: Field[] = ['summary', 'optimistic', 'likely', 'pessimistic'];

interface TaskEditFormProps {
  task: ReviewTask;
  previewEstimate: (estimate: ReviewTask['estimate']) => EstimatePreview;
  error: string | null;
  onSave: (patch: TaskPatch) => void | Promise<void>;
  onCancel: () => void;
}

export function TaskEditForm({ task, previewEstimate, error, onSave, onCancel }: TaskEditFormProps) {
  const [values, setValues] = useState<Record<Field, string>>({ summary: task.summary, ...task.estimate });
  const [focus, setFocus] = useState(0);

  const estimate = { optimistic: values.optimistic, likely: values.likely, pessimistic: values.pessimistic };
  const preview = previewEstimate(estimate);
  const summaryValid = values.summary.trim().length > 0;

  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.upArrow) setFocus((i) => Math.max(0, i - 1));
    else if (key.downArrow || key.tab) setFocus((i) => Math.min(FIELD_ORDER.length - 1, i + 1));
  });

  const submit = () => {
    if (focus < FIELD_ORDER.length - 1) setFocus(focus + 1);
    else if (preview.ok && summaryValid) void onSave({ summary: values.summary, estimate });
  };

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {PLAN_TEXTS.editTitle(task.id)}
      </Text>
      {FIELD_ORDER.map((field, index) => (
        <Box key={field}>
          <Text color={index === focus ? COLORS.brand : undefined}>{PLAN_TEXTS.fields[field]}: </Text>
          <TextInput
            value={values[field]}
            focus={index === focus}
            onChange={(value) => setValues((v) => ({ ...v, [field]: value }))}
            onSubmit={submit}
          />
        </Box>
      ))}
      {preview.ok ? (
        <Text color={COLORS.accent}>
          {PLAN_TEXTS.preview(formatDuration(preview.expectedSeconds), formatDuration(preview.stdDevSeconds))}
        </Text>
      ) : (
        <Text color={COLORS.error}>{preview.message}</Text>
      )}
      {!summaryValid && <Text color={COLORS.error}>{PLAN_TEXTS.emptySummary}</Text>}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{FOOTER_HINTS.edit}</Text>
    </Box>
  );
}
