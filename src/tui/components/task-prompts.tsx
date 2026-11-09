import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS, DELETE_CONFIRM_WORD, FOOTER_HINTS, KEYS } from '../texts.js';

interface YesNoPromptProps {
  question: string;
  onYes: () => void;
  onNo: () => void;
  // Esc aparte de n; sin él Esc equivale a n
  onCancel?: () => void;
}

// Solo s/y confirma; n o Esc cancelan y cualquier otra tecla se ignora
export function YesNoPrompt({ question, onYes, onNo, onCancel = onNo }: YesNoPromptProps) {
  useInput((input, key) => {
    const letter = input.toLowerCase();
    if (letter === KEYS.confirmYes || letter === KEYS.confirmYesAlt) onYes();
    else if (letter === KEYS.confirmNo) onNo();
    else if (key.escape) onCancel();
  });
  return (
    <Box flexDirection="column">
      <Text bold>{question}</Text>
      <Text color={COLORS.muted}>{FOOTER_HINTS.yesNo}</Text>
    </Box>
  );
}

interface TypedConfirmProps {
  prompt: string;
  onConfirm: () => void;
  onMismatch: () => void;
  onCancel: () => void;
}

// Borrar exige escribir la palabra completa: una tecla suelta no basta
export function TypedConfirm({ prompt, onConfirm, onMismatch, onCancel }: TypedConfirmProps) {
  const [value, setValue] = useState('');
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
  return (
    <Box flexDirection="column">
      <Box>
        <Text>{prompt}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(typed) => (typed.trim() === DELETE_CONFIRM_WORD ? onConfirm() : onMismatch())}
        />
      </Box>
      <Text color={COLORS.muted}>{FOOTER_HINTS.typeConfirm}</Text>
    </Box>
  );
}
