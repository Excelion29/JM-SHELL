import React from 'react';
import { Box, Text } from 'ink';
import { TerminalSizeContext, useTrackedTerminalSize } from './terminal-size.js';
import { APP_NAME, COLORS, FRAME_BOTTOM_MARGIN, NO_PROJECT_LABEL } from '../texts.js';

interface FrameProps {
  projectKey: string | null;
  hint: string;
  children: React.ReactNode;
}

// Ocupa la ventana menos una fila (Ink repinta todo si el alto llega a las filas): lo que no cabe se recorta dentro y el pie queda fijo abajo
export function Frame({ projectKey, hint, children }: FrameProps) {
  const size = useTrackedTerminalSize();
  return (
    <TerminalSizeContext.Provider value={size}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={1}
        width={size.columns}
        height={size.rows === undefined ? undefined : Math.max(1, size.rows - FRAME_BOTTOM_MARGIN)}
      >
        <Box justifyContent="space-between" flexShrink={0}>
          <Text bold color={COLORS.brand}>
            {APP_NAME}
          </Text>
          <Text color={COLORS.muted}>{projectKey ?? NO_PROJECT_LABEL}</Text>
        </Box>
        <Box flexDirection="column" marginY={1} flexGrow={1} flexShrink={1} overflow="hidden">
          {children}
        </Box>
        {hint && (
          <Box flexShrink={0}>
            <Text color={COLORS.muted}>{hint}</Text>
          </Box>
        )}
      </Box>
    </TerminalSizeContext.Provider>
  );
}
