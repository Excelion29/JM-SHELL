import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
// Solo tipos: se borra al compilar, la isla ESM no importa código CJS
import type { ChatBridge, ChatHeader, ChatLine, ChatUiEvent } from '../../refinement/chat-types.js';
import { wrapText } from '../components/wrap-text.js';
import {
  CHAT_CHROME_ROWS,
  CHAT_DEFAULT_TERMINAL_COLUMNS,
  CHAT_DEFAULT_TERMINAL_ROWS,
  CHAT_HORIZONTAL_MARGIN,
  CHAT_KEYS,
  CHAT_MODEL_LABELS,
  CHAT_TEXTS,
  CHAT_VISIBLE_MIN_ROWS,
  COLORS,
  CURSOR,
  MAX_CHAT_LINES,
  STREAM_FLUSH_MS,
} from '../texts.js';

export interface ChatScreenProps {
  chatKey: string;
  chat: ChatBridge;
  onBack: () => void;
  onHandoff: () => void;
}

const READ_TOOLS = ['Read'];
const SEARCH_TOOLS = ['Grep', 'Glob'];
const WRITE_TOOLS = ['Write', 'Edit'];
const SUBAGENT_TOOLS = ['Agent', 'Task'];
const EXPLORER_NAME = 'explorador';
const PLAN_PHASE = 'plan';

function activityLabel(tool: string, target: string): string {
  const { activity } = CHAT_TEXTS;
  if (READ_TOOLS.includes(tool)) return activity.read(target);
  if (SEARCH_TOOLS.includes(tool)) return activity.search(target);
  if (WRITE_TOOLS.includes(tool)) return activity.write(target);
  if (SUBAGENT_TOOLS.includes(tool) && target === EXPLORER_NAME) return activity.explore;
  return activity.other(tool);
}

interface Row {
  text: string;
  role: ChatLine['role'];
}

function toRows(lines: ChatLine[], width: number): Row[] {
  return lines.flatMap(({ role, text }) => {
    const label = role === 'user' ? CHAT_TEXTS.userLabel : CHAT_TEXTS.assistantLabel;
    return wrapText(`${label}: ${text}`, width).map((row) => ({ text: row, role }));
  });
}

const capLines = (lines: ChatLine[]) => lines.slice(-MAX_CHAT_LINES);

function HeaderLine({ header }: { header: ChatHeader }) {
  const { tokens, cost, headerBlock } = CHAT_TEXTS;
  return (
    <Text color={COLORS.accent}>
      {header.key} · {header.phaseLabel} · {headerBlock}: {header.blockLabel} · {CHAT_MODEL_LABELS[header.model]} ·{' '}
      {tokens(header.totalTokens)} · {cost(header.costUsd)}
    </Text>
  );
}

export function ChatScreen({ chatKey, chat, onBack, onHandoff }: ChatScreenProps) {
  const { stdout } = useStdout();
  const [header, setHeader] = useState<ChatHeader | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [streaming, setStreaming] = useState('');
  const [activity, setActivity] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [input, setInput] = useState('');
  const [scroll, setScroll] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const ready = header !== null;
  const closing = useRef(false);
  const pendingText = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      flushTimer.current = null;
      const text = pendingText.current;
      pendingText.current = '';
      if (text) setStreaming((current) => current + text);
    };
    const discardPending = () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      pendingText.current = '';
    };
    const onEvent = (event: ChatUiEvent) => {
      if (event.type === 'textDelta') {
        setActivity(null);
        pendingText.current += event.text;
        if (!flushTimer.current) flushTimer.current = setTimeout(flush, STREAM_FLUSH_MS);
      } else if (event.type === 'assistantText') {
        discardPending();
        setStreaming('');
        setLines((all) => capLines([...all, { role: 'assistant', text: event.text, at: '' }]));
      } else if (event.type === 'activity') {
        setActivity(activityLabel(event.tool, event.target));
      } else if (event.type === 'turnEnd') {
        setHeader(event.header);
        setBusy(false);
        setActivity(null);
        discardPending();
        setStreaming('');
      } else if (event.type === 'header') {
        setHeader(event.header);
      } else {
        setMessage(event.message);
        setBusy(false);
      }
    };
    chat
      .open(chatKey, onEvent)
      .then((opened) => {
        if (closing.current) return;
        setHeader(opened.header);
        setLines(capLines(opened.history));
      })
      .catch((err: unknown) => setOpenError((err as Error).message));
    return () => {
      closing.current = true;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      void chat.close();
    };
  }, [chatKey, chat]);

  const columns = stdout?.columns ?? CHAT_DEFAULT_TERMINAL_COLUMNS;
  const terminalRows = stdout?.rows ?? CHAT_DEFAULT_TERMINAL_ROWS;
  const width = Math.max(20, columns - CHAT_HORIZONTAL_MARGIN);
  const visibleRows = Math.max(CHAT_VISIBLE_MIN_ROWS, terminalRows - CHAT_CHROME_ROWS);
  const committedRows = useMemo(() => toRows(lines, width), [lines, width]);
  const rows = streaming ? [...committedRows, ...toRows([{ role: 'assistant', text: streaming, at: '' }], width)] : committedRows;
  const maxScroll = Math.max(0, rows.length - visibleRows);
  const offset = Math.min(scroll, maxScroll);
  const shown = rows.slice(Math.max(0, rows.length - visibleRows - offset), rows.length - offset);

  const submit = () => {
    const text = input.trim();
    if (!text || busy || !ready) return;
    try {
      chat.send(text);
    } catch (err: unknown) {
      setMessage((err as Error).message);
      return;
    }
    setLines((all) => capLines([...all, { role: 'user', text, at: '' }]));
    setInput('');
    setBusy(true);
    setScroll(0);
    setMessage(null);
  };

  useInput((typed, key) => {
    if (key.escape) onBack();
    else if (key.pageUp) setScroll((s) => Math.min(maxScroll, s + visibleRows - 1));
    else if (key.pageDown) setScroll((s) => Math.max(0, s - (visibleRows - 1)));
    else if (!ready) return;
    else if (key.ctrl && typed === CHAT_KEYS.deepModel) {
      if (!busy) chat.toggleDeep();
    } else if (key.ctrl && typed === CHAT_KEYS.newSession) {
      if (header?.tooLong && !busy) {
        chat.newSession();
        setBusy(true);
      }
    } else if (key.ctrl && typed === CHAT_KEYS.fullClaude) onHandoff();
    else if ((key.ctrl && typed === CHAT_KEYS.newline) || (key.return && key.shift)) setInput((text) => `${text}\n`);
    else if (key.return) submit();
    else if (key.backspace || key.delete) setInput((text) => text.slice(0, -1));
    else if (typed && !key.ctrl && !key.meta) setInput((text) => text + typed.replace(/\r/g, ''));
  });

  if (openError) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.error}>{CHAT_TEXTS.openError(openError)}</Text>
        <Text color={COLORS.muted}>{CHAT_TEXTS.openErrorNextStep}</Text>
      </Box>
    );
  }
  if (!header) return <Text>{CHAT_TEXTS.preparing}</Text>;

  const inputRows = wrapText(`${CHAT_TEXTS.inputPrompt}${input}${CURSOR}`, width);
  return (
    <Box flexDirection="column">
      <HeaderLine header={header} />
      <Box flexDirection="column" marginTop={1}>
        {shown.map((row, index) => (
          <Text key={index} color={row.role === 'user' ? COLORS.brand : undefined}>
            {row.text}
          </Text>
        ))}
      </Box>
      {offset > 0 && <Text color={COLORS.muted}>{CHAT_TEXTS.scrolledHint}</Text>}
      {header.phase === PLAN_PHASE && <Text color={COLORS.accent}>{CHAT_TEXTS.planReady}</Text>}
      {header.tooLong && <Text color={COLORS.accent}>{CHAT_TEXTS.tooLongHint}</Text>}
      {message && <Text color={COLORS.error}>{message}</Text>}
      <Text color={COLORS.muted}>{busy ? (activity ?? CHAT_TEXTS.thinking) : ' '}</Text>
      <Box flexDirection="column">
        {inputRows.map((row, index) => (
          <Text key={index}>{row}</Text>
        ))}
      </Box>
    </Box>
  );
}
