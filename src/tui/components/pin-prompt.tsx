import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS, MIN_PIN_LENGTH, PIN_MASK, PIN_TEXTS } from '../texts.js';

interface PinPromptProps {
  onSubmit: (pin: string) => void;
  error: string | null;
  checking: boolean;
}

export function PinPrompt({ onSubmit, error, checking }: PinPromptProps) {
  const [value, setValue] = useState('');
  const [tooShort, setTooShort] = useState(false);

  const handleSubmit = (pin: string) => {
    if (pin.length < MIN_PIN_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setValue('');
    onSubmit(pin);
  };

  return (
    <Box flexDirection="column">
      <Text bold>{PIN_TEXTS.title}</Text>
      <Box>
        <Text>{PIN_TEXTS.label}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} mask={PIN_MASK} focus={!checking} />
      </Box>
      {tooShort && <Text color={COLORS.error}>{PIN_TEXTS.tooShort}</Text>}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{checking ? PIN_TEXTS.checking : PIN_TEXTS.nextStep}</Text>
    </Box>
  );
}
