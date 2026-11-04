import React from 'react';
import { Box, Text } from 'ink';
import { APP_NAME, COLORS, NO_PROJECT_LABEL } from '../texts.js';

interface FrameProps {
  projectKey: string | null;
  hint: string;
  children: React.ReactNode;
}

export function Frame({ projectKey, hint, children }: FrameProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={COLORS.brand}>
          {APP_NAME}
        </Text>
        <Text color={COLORS.muted}>{projectKey ?? NO_PROJECT_LABEL}</Text>
      </Box>
      <Box flexDirection="column" marginY={1}>
        {children}
      </Box>
      {hint && <Text color={COLORS.muted}>{hint}</Text>}
    </Box>
  );
}
