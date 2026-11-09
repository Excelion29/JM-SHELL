import React from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { SourceResult } from '../../refinement/analysis-types.js';
import { ANALYSIS_TEXTS as T, COLORS } from '../texts.js';

interface SourceResultsProps {
  title: string;
  results: SourceResult[];
  onContinue: () => void;
}

// Qué pasó con cada archivo: los válidos se guardan aunque otros fallen
export function SourceResults({ title, results, onContinue }: SourceResultsProps) {
  useInput((_input, key) => {
    if (key.return || key.escape) onContinue();
  });
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {title}
      </Text>
      {results.length === 0 && <Text>{T.noSources}</Text>}
      {results.map((result, index) => (
        <Text key={`${index}-${result.source}`} color={result.ok ? undefined : COLORS.error}>
          {result.ok ? T.resultOk(result.source, result.file) : T.resultFailed(result.source, result.message)}
        </Text>
      ))}
      <Text color={COLORS.muted}>{T.resultsHint}</Text>
    </Box>
  );
}
