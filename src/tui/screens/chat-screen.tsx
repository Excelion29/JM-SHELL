import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
// Solo tipos: se borra al compilar, la isla ESM no importa código CJS
import type { ChatBridge, ChatHeader, ChatLine, ChatUiEvent } from '../../refinement/chat-types.js';
import { CodeFolderPrompt } from '../components/code-folder-prompt.js';
import { MdRow, renderMarkdown, Span } from '../components/markdown.js';
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
  MESSAGE_INDENT,
  STREAM_FLUSH_MS,
} from '../texts.js';

export interface ChatScreenProps {
  chatKey: string;
  chat: ChatBridge;
  onBack: () => void;
  onHandoff: () => void;
  // Cuántas opciones numeradas se pueden elegir con la tecla del número (0 = ninguna)
  onChoicesChange?: (count: number) => void;
}

const READ_TOOLS = ['Read'];
const SEARCH_TOOLS = ['Grep', 'Glob'];
const WRITE_TOOLS = ['Write', 'Edit'];
const SUBAGENT_TOOLS = ['Agent', 'Task'];
const EXPLORER_NAME = 'explorador';
const PLAN_PHASE = 'plan';
const CHOICE_DIGIT = /^[1-9]$/;
const INDENT: Span = { text: ' '.repeat(MESSAGE_INDENT) };

function activityLabel(tool: string, target: string): string {
  const { activity } = CHAT_TEXTS;
  if (READ_TOOLS.includes(tool)) return activity.read(target);
  if (SEARCH_TOOLS.includes(tool)) return activity.search(target);
  if (WRITE_TOOLS.includes(tool)) return activity.write(target);
  if (SUBAGENT_TOOLS.includes(tool) && target === EXPLORER_NAME) return activity.explore;
  return activity.other(tool);
}

const bodyWidthOf = (width: number) => Math.max(1, width - MESSAGE_INDENT);

// Etiqueta del rol en su propia fila, cuerpo sangrado y una fila en blanco entre mensajes
function toRows(lines: ChatLine[], width: number): MdRow[] {
  const bodyWidth = bodyWidthOf(width);
  return lines.flatMap(({ role, text }) => {
    const label: Span =
      role === 'user'
        ? { text: CHAT_TEXTS.userLabel, bold: true, color: COLORS.brand }
        : { text: CHAT_TEXTS.assistantLabel, bold: true, color: COLORS.accent };
    const body =
      role === 'user'
        ? wrapText(text, bodyWidth).map((row): MdRow => ({ spans: [{ text: row }] }))
        : renderMarkdown(text, bodyWidth).rows;
    return [{ spans: [label] }, ...body.map((row) => ({ spans: [INDENT, ...row.spans] })), { spans: [] }];
  });
}

// Solo el último mensaje cuenta: si el dev ya respondió, las opciones quedaron viejas
function choicesOf(lines: ChatLine[], width: number): string[] {
  const last = lines[lines.length - 1];
  return last?.role === 'assistant' ? renderMarkdown(last.text, bodyWidthOf(width)).choices : [];
}

const capLines = (lines: ChatLine[]) => lines.slice(-MAX_CHAT_LINES);

function HeaderLine({ header }: { header: ChatHeader }) {
  const { context, cost, headerBlock } = CHAT_TEXTS;
  const contextPart = header.contextTokens > 0 ? `${context(header.contextTokens)} · ` : '';
  return (
    <Text color={COLORS.accent}>
      {header.key} · {header.phaseLabel} · {headerBlock}: {header.blockLabel} · {CHAT_MODEL_LABELS[header.model]} ·{' '}
      {contextPart}
      {cost(header.costUsd)}
    </Text>
  );
}

function RowText({ row }: { row: MdRow }) {
  if (row.spans.length === 0) return <Text> </Text>;
  return (
    <Text>
      {row.spans.map((span, index) => (
        <Text key={index} bold={span.bold} italic={span.italic} dimColor={span.dim} color={span.color}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

type Gate = 'checking' | 'open' | { projectKey: string; suggestedFolder: string | null; confirmCwd: boolean };

export function ChatScreen({ chatKey, chat, onBack, onHandoff, onChoicesChange }: ChatScreenProps) {
  const { stdout } = useStdout();
  const [codeFolder, setCodeFolder] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate>('checking');
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
    chat
      .checkCodeFolder(chatKey)
      .then((check) => {
        if (check.status === 'ready') {
          setCodeFolder(check.codeFolder);
          setGate('open');
        } else setGate(check);
      })
      .catch((err: unknown) => setOpenError((err as Error).message));
  }, [chatKey, chat]);

  useEffect(() => {
    if (gate !== 'open') return undefined;
    closing.current = false;
    setHeader(null);
    setLines([]);
    setBusy(true);
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
  }, [chatKey, chat, gate]);

  const columns = stdout?.columns ?? CHAT_DEFAULT_TERMINAL_COLUMNS;
  const terminalRows = stdout?.rows ?? CHAT_DEFAULT_TERMINAL_ROWS;
  const width = Math.max(20, columns - CHAT_HORIZONTAL_MARGIN);
  const visibleRows = Math.max(CHAT_VISIBLE_MIN_ROWS, terminalRows - CHAT_CHROME_ROWS);
  const committedRows = useMemo(() => toRows(lines, width), [lines, width]);
  const rows = streaming
    ? [...committedRows, ...toRows([{ role: 'assistant', text: streaming, at: '' }], width)]
    : committedRows;
  const choices = useMemo(() => choicesOf(lines, width), [lines, width]);
  const choiceCount = ready && !busy ? choices.length : 0;
  const maxScroll = Math.max(0, rows.length - visibleRows);
  const offset = Math.min(scroll, maxScroll);
  const shown = rows.slice(Math.max(0, rows.length - visibleRows - offset), rows.length - offset);

  useEffect(() => {
    onChoicesChange?.(choiceCount);
    return () => onChoicesChange?.(0);
  }, [choiceCount, onChoicesChange]);

  const sendText = (raw: string) => {
    const text = raw.trim();
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

  const reopenCodeFolder = () => {
    chat
      .checkCodeFolder(chatKey, true)
      .then((check) => {
        if (check.status === 'needs-folder') setGate(check);
      })
      .catch((err: unknown) => setMessage((err as Error).message));
  };

  useInput((typed, key) => {
    if (gate !== 'open') return;
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
    else if (key.ctrl && typed === CHAT_KEYS.codeFolder) {
      if (input === '' && !busy) reopenCodeFolder();
    } else if (key.return) sendText(input);
    else if (key.backspace || key.delete) setInput((text) => text.slice(0, -1));
    else if (CHOICE_DIGIT.test(typed) && input === '' && !busy && choices[Number(typed) - 1] !== undefined) {
      sendText(`${typed}. ${choices[Number(typed) - 1]}`);
    } else if (typed && !key.ctrl && !key.meta) setInput((text) => text + typed.replace(/\r/g, ''));
  });

  if (openError) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.error}>{CHAT_TEXTS.openError(openError)}</Text>
        <Text color={COLORS.muted}>{CHAT_TEXTS.openErrorNextStep}</Text>
      </Box>
    );
  }
  if (typeof gate === 'object') {
    return (
      <CodeFolderPrompt
        projectKey={gate.projectKey}
        initialFolder={gate.suggestedFolder}
        confirmCwd={gate.confirmCwd}
        onSave={async (folder) => {
          const result = await chat.saveCodeFolder(gate.projectKey, folder);
          if (result.ok) {
            setCodeFolder(folder.trim());
            setGate('open');
          }
          return result;
        }}
        onSkip={() => {
          chat.skipCodeFolder(gate.projectKey);
          setCodeFolder(null);
          setGate('open');
        }}
        onCancel={onBack}
      />
    );
  }
  if (!header) return <Text>{CHAT_TEXTS.preparing}</Text>;

  const inputRows = wrapText(`${CHAT_TEXTS.inputPrompt}${input}${CURSOR}`, width);
  return (
    <Box flexDirection="column">
      <HeaderLine header={header} />
      <Text color={COLORS.muted}>{codeFolder ? CHAT_TEXTS.codeFolderLine(codeFolder) : CHAT_TEXTS.noCodeNote}</Text>
      <Box flexDirection="column" marginTop={1}>
        {shown.map((row, index) => (
          <RowText key={index} row={row} />
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
