import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { SaveCodeFolderResult } from '../../refinement/chat-types.js';
import { CHAT_TEXTS, CODE_FOLDER_TEXTS, COLORS, CURSOR } from '../texts.js';

interface CodeFolderPromptProps {
  projectKey: string;
  initialFolder?: string | null;
  // Pregunta de confirmación cuando la carpeta sugerida es el directorio actual
  confirmCwd?: boolean;
  onSave: (folder: string) => Promise<SaveCodeFolderResult>;
  onSkip: () => void;
  onCancel: () => void;
}

type Focus = 'path' | 'no-code';

export function CodeFolderPrompt({
  projectKey,
  initialFolder = null,
  confirmCwd = false,
  onSave,
  onSkip,
  onCancel,
}: CodeFolderPromptProps) {
  const [folder, setFolder] = useState(initialFolder ?? '');
  // Lo sugerido se reemplaza al escribir: "escribe otra ruta" no obliga a borrar
  const [pristine, setPristine] = useState(initialFolder !== null);
  const [focus, setFocus] = useState<Focus>('path');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!folder.trim()) {
      setError(CHAT_TEXTS.noPathError);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave(folder);
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
    }
  };

  useInput((typed, key) => {
    if (saving) return;
    if (key.escape) onCancel();
    else if (key.downArrow) setFocus('no-code');
    else if (key.upArrow) setFocus('path');
    else if (key.return) {
      if (focus === 'no-code') onSkip();
      else void save();
    } else if (focus !== 'path') return;
    else if (key.backspace || key.delete) {
      setPristine(false);
      setFolder((text) => text.slice(0, -1));
    } else if (typed && !key.ctrl && !key.meta) {
      const added = typed.replace(/[\r\n]/g, '');
      setFolder((text) => (pristine ? added : text + added));
      setPristine(false);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {CODE_FOLDER_TEXTS.title(projectKey)}
      </Text>
      <Text color={COLORS.muted}>
        {initialFolder !== null && confirmCwd
          ? CODE_FOLDER_TEXTS.confirmCwd(projectKey)
          : CODE_FOLDER_TEXTS.explanation}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {CODE_FOLDER_TEXTS.pathLabel}
          {folder}
          {focus === 'path' ? CURSOR : ''}
        </Text>
        <Text color={focus === 'no-code' ? COLORS.brand : undefined}>
          {focus === 'no-code' ? `${CODE_FOLDER_TEXTS.optionMarker} ` : '  '}
          {CODE_FOLDER_TEXTS.noCodeOption}
        </Text>
      </Box>
      {saving && <Text color={COLORS.muted}>{CODE_FOLDER_TEXTS.saving}</Text>}
      {error && <Text color={COLORS.error}>{error}</Text>}
      <Text color={COLORS.muted}>{CODE_FOLDER_TEXTS.nextStep}</Text>
    </Box>
  );
}
