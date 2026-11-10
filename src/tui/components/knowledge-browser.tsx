import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Solo tipos: se borra al compilar
import type { ChatBridge, KnowledgeListing, KnowledgeTarget } from '../../refinement/chat-types.js';
import { COLORS, HOME_TEXTS, KEYS, KNOWLEDGE_TEXTS, VISIBLE_ROWS } from '../texts.js';
import { windowStart } from './picker-list.js';

interface KnowledgeBrowserProps {
  chat: ChatBridge;
  connection: KnowledgeTarget;
  onSelect: (baseFolder: string) => void;
  onCancel: () => void;
  // Con onNotes el navegador elige notas (varias) en lugar de una carpeta base
  onNotes?: (notes: string[]) => void;
  initialDir?: string;
}

interface Preview {
  file: string;
  text: string | null;
  error: string | null;
}

const NOTE_EXTENSION = '.md';
const SEPARATOR = '/';

const joinPath = (dir: string, name: string) => (dir ? `${dir}${SEPARATOR}${name}` : name);
const parentOf = (dir: string) => dir.split(SEPARATOR).slice(0, -1).join(SEPARATOR);

export function KnowledgeBrowser({
  chat,
  connection,
  onSelect,
  onCancel,
  onNotes,
  initialDir = '',
}: KnowledgeBrowserProps) {
  const [dir, setDir] = useState(initialDir);
  const [marked, setMarked] = useState<string[]>([]);
  const [noneMarked, setNoneMarked] = useState(false);
  const [listing, setListing] = useState<KnowledgeListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rootConfirm, setRootConfirm] = useState(false);

  useEffect(() => {
    let active = true;
    setRootConfirm(false);
    setListing(null);
    setError(null);
    setSelected(0);
    chat
      .listKnowledge(connection, dir)
      .then((result) => active && setListing(result))
      .catch((err: unknown) => active && setError((err as Error).message));
    return () => {
      active = false;
    };
  }, [chat, connection, dir]);

  const entries = listing?.entries ?? [];

  const openEntry = () => {
    const entry = entries[selected];
    if (!entry) return;
    const target = joinPath(dir, entry.name);
    if (entry.isFolder) {
      setDir(target);
      return;
    }
    if (!entry.name.endsWith(NOTE_EXTENSION)) return;
    setPreview({ file: target, text: null, error: null });
    chat
      .previewKnowledge(connection, target)
      .then((text) => setPreview({ file: target, text, error: null }))
      .catch((err: unknown) => setPreview({ file: target, text: null, error: (err as Error).message }));
  };

  const toggleNote = () => {
    const entry = entries[selected];
    if (!entry || entry.isFolder || !entry.name.endsWith(NOTE_EXTENSION)) return;
    const target = joinPath(dir, entry.name);
    setNoneMarked(false);
    setMarked((all) => (all.includes(target) ? all.filter((note) => note !== target) : [...all, target]));
  };

  useInput((input, key) => {
    const goBack = key.backspace || key.delete || key.leftArrow;
    if (rootConfirm) {
      if (input === KEYS.confirmYes || input === KEYS.confirmYesAlt) onSelect('');
      else setRootConfirm(false);
    } else if (preview) {
      if (key.escape || goBack) setPreview(null);
    } else if (key.escape) onCancel();
    else if (goBack) setDir(parentOf(dir));
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(entries.length - 1, i + 1));
    else if (key.return) openEntry();
    else if (onNotes && input === KEYS.toggle) toggleNote();
    else if (onNotes && input === KEYS.selectFolder) {
      if (marked.length === 0) setNoneMarked(true);
      else onNotes(marked);
    } else if (input === KEYS.selectFolder && listing) {
      if (dir === '') setRootConfirm(true);
      else onSelect(dir);
    }
  });

  if (preview) return <PreviewView preview={preview} />;

  const start = windowStart(selected, entries.length);
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {onNotes ? KNOWLEDGE_TEXTS.notesTitle(dir) : KNOWLEDGE_TEXTS.browseTitle(dir)}
      </Text>
      {error && <Text color={COLORS.error}>{KNOWLEDGE_TEXTS.browseError(error)}</Text>}
      {!listing && !error && <Text>{KNOWLEDGE_TEXTS.browseLoading}</Text>}
      {rootConfirm && <Text color={COLORS.error}>{KNOWLEDGE_TEXTS.rootConfirm}</Text>}
      {listing && entries.length === 0 && <Text>{KNOWLEDGE_TEXTS.browseEmpty}</Text>}
      {entries.slice(start, start + VISIBLE_ROWS).map((entry, index) => (
        <Text key={entry.name} color={start + index === selected ? COLORS.brand : undefined}>
          {start + index === selected ? HOME_TEXTS.selectedMarker : ' '}{' '}
          {onNotes && !entry.isFolder
            ? `${KNOWLEDGE_TEXTS.notesMarker(marked.includes(joinPath(dir, entry.name)))} `
            : ''}
          {entry.name}
          {entry.isFolder ? KNOWLEDGE_TEXTS.folderSuffix : ''}
        </Text>
      ))}
      {noneMarked && <Text color={COLORS.error}>{KNOWLEDGE_TEXTS.notesNoneMarked}</Text>}
      {onNotes && <Text>{KNOWLEDGE_TEXTS.notesCount(marked.length)}</Text>}
      {listing && !onNotes && (
        <Text color={COLORS.muted}>
          {KNOWLEDGE_TEXTS.adrLine(
            listing.adrFolder,
            entries.some((e) => e.isFolder && e.name === listing.adrFolder),
          )}
        </Text>
      )}
      <Text color={COLORS.muted}>{onNotes ? KNOWLEDGE_TEXTS.notesNextStep : KNOWLEDGE_TEXTS.browseNextStep}</Text>
    </Box>
  );
}

function PreviewView({ preview }: { preview: Preview }) {
  return (
    <Box flexDirection="column">
      <Text bold color={COLORS.accent}>
        {KNOWLEDGE_TEXTS.previewTitle(preview.file)}
      </Text>
      {preview.error && <Text color={COLORS.error}>{KNOWLEDGE_TEXTS.previewError(preview.error)}</Text>}
      {preview.text !== null && <Text>{preview.text}</Text>}
      <Text color={COLORS.muted}>{KNOWLEDGE_TEXTS.previewBack}</Text>
    </Box>
  );
}
