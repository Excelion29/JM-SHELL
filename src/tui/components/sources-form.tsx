import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { ANALYSIS_TEXTS as T, COLORS } from '../texts.js';

export type SourcesField = 'name' | 'paths' | 'text';
export type SourcesValues = Record<SourcesField, string>;

interface SourcesFormProps {
  title: string;
  fields: readonly SourcesField[];
  onSubmit: (values: SourcesValues) => void;
  onCancel: () => void;
  error?: string | null;
}

const EMPTY_VALUES: SourcesValues = { name: '', paths: '', text: '' };

// Campos en una sola línea: Enter pasa al siguiente y en el último guarda
export function SourcesForm({ title, fields, onSubmit, onCancel, error = null }: SourcesFormProps) {
  const [values, setValues] = useState<SourcesValues>(EMPTY_VALUES);
  const [focus, setFocus] = useState(0);
  const [missingName, setMissingName] = useState(false);

  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.upArrow) setFocus((i) => Math.max(0, i - 1));
    else if (key.downArrow || key.tab) setFocus((i) => Math.min(fields.length - 1, i + 1));
  });

  const submit = () => {
    if (focus < fields.length - 1) {
      setFocus(focus + 1);
      return;
    }
    if (fields.includes('name') && !values.name.trim()) {
      setMissingName(true);
      setFocus(fields.indexOf('name'));
      return;
    }
    onSubmit(values);
  };

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {title}
      </Text>
      {fields.map((field, index) => (
        <Box key={field}>
          <Text color={index === focus ? COLORS.brand : undefined}>{T.fields[field]}: </Text>
          <TextInput
            value={values[field]}
            focus={index === focus}
            onChange={(value) => {
              setMissingName(false);
              setValues((v) => ({ ...v, [field]: value }));
            }}
            onSubmit={submit}
          />
        </Box>
      ))}
      {missingName && <Text color={COLORS.error}>{T.nameRequired}</Text>}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{T.sourcesHint}</Text>
      <Text color={COLORS.muted}>{T.formHint}</Text>
    </Box>
  );
}
