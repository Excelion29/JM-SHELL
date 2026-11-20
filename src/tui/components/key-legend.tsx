import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, HINT_ITEM_GAP, type Hint } from '../texts.js';

// Cada ítem es un bloque que no se parte: la leyenda salta de línea solo entre ítems
export function KeyLegend({ hint }: { hint: Hint }) {
  return (
    <Box flexWrap="wrap">
      {hint.map((item) => (
        <Box key={`${item.key}|${item.label}`} flexShrink={0} marginRight={HINT_ITEM_GAP}>
          <Text>
            {item.key && (
              <Text bold color={COLORS.brand}>
                {item.key}
              </Text>
            )}
            {item.key && item.label ? ' ' : ''}
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
