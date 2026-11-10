// Notas de la base referenciadas desde una historia o un análisis: se guardan como ruta relativa a la bóveda y no se copian
import type { ChatKnowledge } from './chat-types';

export const REFERENCED_NOTES_MAX = 50;
export const NOTE_PATH_MAX_LENGTH = 300;
const NOTE_EXTENSION = '.md';
const SEPARATOR = '/';
const COLON = ':';
const BACKTICK = '`';
// Controles, "\" y los separadores Unicode de línea o bidireccionales
const UNSAFE_NOTE_CHARS = /[\u0000-\u001f\u007f-\u009f\\\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const UNICODE_NORMAL_FORM = 'NFKC';

// null si la ruta no es una nota .md relativa y sin trucos (absoluta, "..", segmentos ocultos, controles)
export function cleanNotePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const note = raw.trim();
  const invalid =
    note === '' ||
    note.length > NOTE_PATH_MAX_LENGTH ||
    !note.endsWith(NOTE_EXTENSION) ||
    note.startsWith(SEPARATOR) ||
    note.includes(COLON) ||
    note.includes(BACKTICK) ||
    note.includes('..') ||
    UNSAFE_NOTE_CHARS.test(note) ||
    note.normalize(UNICODE_NORMAL_FORM) !== note ||
    note.split(SEPARATOR).some((segment) => segment === '' || segment.startsWith('.'));
  return invalid ? null : note;
}

export function assertNotePath(raw: string): string {
  const note = cleanNotePath(raw);
  if (note === null) throw new Error(`Ruta de nota no válida: "${raw}". Debe ser una nota .md dentro de la base.`);
  return note;
}

// Lo que llega de estado.json: lo inválido se descarta, sin repetidos y con tope
export function readReferencedNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const notes = value.flatMap((item) => {
    const note = cleanNotePath(item);
    return note === null ? [] : [note];
  });
  return [...new Set(notes)].slice(0, REFERENCED_NOTES_MAX);
}

export function mergeReferencedNotes(existing: string[], added: string[]): string[] {
  const merged = [...new Set([...existing, ...added.map(assertNotePath)])];
  if (merged.length > REFERENCED_NOTES_MAX)
    throw new Error(`Se pueden referenciar hasta ${REFERENCED_NOTES_MAX} notas.`);
  return merged;
}

// Mensaje fijo que pide a Claude leer las notas: ruta absoluta con base local, ruta de la bóveda con MCP
export function buildNotesMessage(notes: string[], kb: ChatKnowledge | null): string {
  const lines = notes.map((note) =>
    kb?.type === 'local' ? `- \`${kb.root.replace(/\\/g, SEPARATOR)}/${note}\`` : `- \`${note}\``,
  );
  const how = kb?.type === 'local' ? 'con Read' : 'con vault_read (ruta de la bóveda)';
  return `El dev referenció estas notas de la base de conocimiento. Léelas ${how} antes de seguir y tenlas en cuenta:\n${lines.join('\n')}`;
}
