import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS, ISSUE_KEY_PATTERN, MANUAL_KEY_TEXTS } from '../texts.js';

interface ManualKeyInputProps {
  onSubmit: (key: string) => void;
  onCancel: () => void;
}

export function ManualKeyInput({ onSubmit, onCancel }: ManualKeyInputProps) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const submit = (value: string) => {
    const candidate = value.trim().toUpperCase();
    if (!ISSUE_KEY_PATTERN.test(candidate)) {
      setInvalid(true);
      return;
    }
    onSubmit(candidate);
  };

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {MANUAL_KEY_TEXTS.title}
      </Text>
      <Box>
        <Text>{MANUAL_KEY_TEXTS.label}</Text>
        <TextInput value={draft} onChange={setDraft} onSubmit={submit} />
      </Box>
      {invalid && <Text color={COLORS.error}>{MANUAL_KEY_TEXTS.invalidKey}</Text>}
      <Text color={COLORS.muted}>{MANUAL_KEY_TEXTS.nextStep}</Text>
    </Box>
  );
}
