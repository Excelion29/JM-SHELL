import React from 'react';
import { Box, Text, useInput } from 'ink';
import { BROWSE_TEXTS, COLORS, FOOTER_HINTS, KEYS } from '../texts.js';
import type { LoadState } from './use-load.js';

interface LoadGateProps<T> {
  state: LoadState<T>;
  loadingText: string;
  onRetry: () => void;
  onBack: () => void;
  children: (data: T) => React.ReactNode;
}

export function LoadGate<T>({ state, loadingText, onRetry, onBack, children }: LoadGateProps<T>) {
  if (state.status === 'ready') return <>{children(state.data)}</>;
  return <Waiting state={state} loadingText={loadingText} onRetry={onRetry} onBack={onBack} />;
}

function Waiting<T>({ state, loadingText, onRetry, onBack }: Omit<LoadGateProps<T>, 'children'>) {
  useInput((input, key) => {
    if (key.escape) onBack();
    else if (state.status === 'error' && input === KEYS.retry) onRetry();
  });

  return (
    <Box flexDirection="column">
      {state.status === 'error' ? (
        <>
          <Text color={COLORS.error}>{BROWSE_TEXTS.loadError(state.message)}</Text>
          <Text color={COLORS.muted}>{BROWSE_TEXTS.loadErrorNextStep}</Text>
        </>
      ) : (
        <Text>{loadingText}</Text>
      )}
      <Text color={COLORS.muted}>{FOOTER_HINTS.status}</Text>
    </Box>
  );
}
