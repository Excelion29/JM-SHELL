import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, HOME_TEXTS } from '../texts.js';

export function HomeScreen() {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {HOME_TEXTS.title}
      </Text>
      <Text>{HOME_TEXTS.empty}</Text>
      <Text color={COLORS.muted}>{HOME_TEXTS.nextStep}</Text>
    </Box>
  );
}
