import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { BROWSE_TEXTS, COLORS, FOOTER_HINTS, HOME_TEXTS, ROW_SEPARATOR, VISIBLE_ROWS } from '../texts.js';

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  tag?: string;
}

interface PickerListProps {
  title: string;
  items: PickerItem[];
  nextStep: string;
  hint: string;
  emptyText?: string;
  limitReached?: boolean;
  // Solo se activan con el filtro vacío: así no chocan con escribir texto
  shortcuts?: Record<string, () => void>;
  onSelect: (id: string) => void;
  onBack: () => void;
}

function matches(item: PickerItem, filter: string): boolean {
  const needle = filter.toLowerCase();
  return `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(needle);
}

export function windowStart(selected: number, total: number): number {
  const centered = selected - Math.floor(VISIBLE_ROWS / 2);
  return Math.max(0, Math.min(centered, total - VISIBLE_ROWS));
}

export function PickerList({
  title,
  items,
  nextStep,
  hint,
  emptyText,
  limitReached = false,
  shortcuts = {},
  onSelect,
  onBack,
}: PickerListProps) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);

  const visible = items.filter((item) => matches(item, filter));
  const current = Math.min(selected, Math.max(0, visible.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      if (filter) {
        setFilter('');
        setSelected(0);
      } else onBack();
    } else if (key.upArrow) setSelected(Math.max(0, current - 1));
    else if (key.downArrow) setSelected(Math.min(visible.length - 1, current + 1));
    else if (key.return) {
      if (visible[current]) onSelect(visible[current].id);
    } else if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelected(0);
    } else if (!filter && shortcuts[input]) shortcuts[input]();
    else if (input && !key.ctrl && !key.meta && !key.tab) {
      setFilter((f) => f + input);
      setSelected(0);
    }
  });

  const start = windowStart(current, visible.length);
  const rows = visible.slice(start, start + VISIBLE_ROWS);

  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {title}
      </Text>
      {filter && (
        <Text>
          {BROWSE_TEXTS.filterLabel}
          {filter}
        </Text>
      )}
      {visible.length === 0 && <Text>{filter ? BROWSE_TEXTS.noMatches : (emptyText ?? BROWSE_TEXTS.noMatches)}</Text>}
      {rows.map((item, index) => {
        const active = start + index === current;
        return (
          <Text key={item.id} color={active ? COLORS.brand : undefined}>
            {active ? HOME_TEXTS.selectedMarker : ' '} {item.label}
            {item.detail && <Text color={COLORS.muted}>{`${ROW_SEPARATOR}${item.detail}`}</Text>}
            {item.tag && <Text color={COLORS.accent}>{` ${item.tag}`}</Text>}
          </Text>
        );
      })}
      {limitReached && <Text color={COLORS.muted}>{BROWSE_TEXTS.limitNote}</Text>}
      <Text color={COLORS.muted}>{nextStep}</Text>
      <Text color={COLORS.muted}>{filter ? FOOTER_HINTS.filtering : hint}</Text>
    </Box>
  );
}
