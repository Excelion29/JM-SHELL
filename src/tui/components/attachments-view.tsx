import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AttachmentPurpose } from '../../refinement/types.js';
import type { ReviewFile, ReviewTask } from '../../refinement/review-types.js';
import {
  COLORS,
  FOOTER_HINTS,
  HOME_TEXTS,
  KEYS,
  PLAN_TEXTS,
  PURPOSE_CYCLE,
  PURPOSE_HELP,
  PURPOSE_LABELS,
} from '../texts.js';

interface AttachmentsViewProps {
  files: ReviewFile[];
  tasks: ReviewTask[];
  error: string | null;
  onCyclePurpose: (file: string, purpose: AttachmentPurpose) => void;
  onToggleTask: (file: string, taskId: string) => void;
  onOpen: (file: string) => void;
  onBack: () => void;
}

const nextPurpose = (purpose: AttachmentPurpose): AttachmentPurpose =>
  PURPOSE_CYCLE[(PURPOSE_CYCLE.indexOf(purpose) + 1) % PURPOSE_CYCLE.length];

export function AttachmentsView({
  files,
  tasks,
  error,
  onCyclePurpose,
  onToggleTask,
  onOpen,
  onBack,
}: AttachmentsViewProps) {
  const [selected, setSelected] = useState(0);
  const [taskCursor, setTaskCursor] = useState(0);
  const [picking, setPicking] = useState(false);
  const file = files[selected];

  useInput((input, key) => {
    if (picking) {
      if (key.escape) setPicking(false);
      else if (key.upArrow) setTaskCursor((i) => Math.max(0, i - 1));
      else if (key.downArrow) setTaskCursor((i) => Math.min(tasks.length - 1, i + 1));
      else if (input === KEYS.toggle && file && tasks[taskCursor]) onToggleTask(file.file, tasks[taskCursor].id);
      return;
    }
    if (key.escape) onBack();
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(files.length - 1, i + 1));
    else if (input === KEYS.toggle && file) onCyclePurpose(file.file, nextPurpose(file.purpose));
    else if (key.return && file && tasks.length > 0) {
      setTaskCursor(0);
      setPicking(true);
    } else if (input === KEYS.open && file) onOpen(file.file);
  });

  if (picking && file) {
    return (
      <Box flexDirection="column">
        <Text bold color={COLORS.accent}>
          {PLAN_TEXTS.fileTasksTitle(file.file)}
        </Text>
        {tasks.map((task, index) => (
          <Text key={task.id} color={index === taskCursor ? COLORS.brand : undefined}>
            {index === taskCursor ? HOME_TEXTS.selectedMarker : ' '}{' '}
            {file.taskIds.includes(task.id) ? PLAN_TEXTS.included : PLAN_TEXTS.excluded} {task.id} {task.summary}
          </Text>
        ))}
        {error && <Text color={COLORS.error}>{error}</Text>}
        <Text color={COLORS.muted}>{FOOTER_HINTS.fileTasks}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {PLAN_TEXTS.filesTitle}
      </Text>
      {files.length === 0 && <Text>{PLAN_TEXTS.noFiles}</Text>}
      {files.map((f, index) => (
        <Text key={f.file} color={index === selected ? COLORS.brand : undefined}>
          {index === selected ? HOME_TEXTS.selectedMarker : ' '} {f.file} · {PURPOSE_LABELS[f.purpose]} →{' '}
          {f.taskIds.length ? f.taskIds.join(', ') : PLAN_TEXTS.noTasksAssigned}
        </Text>
      ))}
      {file && <Text color={COLORS.muted}>{PURPOSE_HELP[file.purpose]}</Text>}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{PLAN_TEXTS.filesNextStep}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.files}</Text>
    </Box>
  );
}
