import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, FOOTER_HINTS, HOME_TEXTS } from '../texts.js';

interface OptionSelectorProps {
  title: string;
  options: string[];
  onSelect: (option: string) => void;
  onCancel: () => void;
}

// Selector simple de transiciones de Jira (el de inquirer rompería Ink)
export function OptionSelector({ title, options, onSelect, onCancel }: OptionSelectorProps) {
  const [selected, setSelected] = useState(0);
  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(options.length - 1, i + 1));
    else if (key.return && options[selected]) onSelect(options[selected]);
  });
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {title}
      </Text>
      {options.map((option, index) => (
        <Text key={option} color={index === selected ? COLORS.brand : undefined}>
          {index === selected ? HOME_TEXTS.selectedMarker : ' '} {option}
        </Text>
      ))}
      <Text color={COLORS.muted}>{FOOTER_HINTS.options}</Text>
    </Box>
  );
}
