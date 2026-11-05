// Tablas GFM del chat: análisis, reparto de anchos y dibujo con bordes (puro, sin Ink)
import { ELLIPSIS } from '../texts.js';
import type { MdRow, Span } from './markdown.js';

export type Align = 'left' | 'right' | 'center';

export interface ParsedTable {
  header: string[];
  aligns: Align[];
  rows: string[][];
}

export interface StyledTable {
  header: Span[][];
  aligns: Align[];
  rows: Span[][][];
}

const CELL_SEPARATOR = '|';
const ESCAPED_PIPE = '\\|';
const CODE_TICK = '`';
const DELIMITER_CELL = /^:?-+:?$/;
const MIN_COLUMN_WIDTH = 6;
const WORD_WIDTH_CAP = 16;
const CELL_PADDING = 2;
const BORDER_EXTRA = 1;
const CARD_INDENT = '  ';
const CARD_SEPARATOR = ' · ';
const CARD_TITLE_COLUMNS = 2;
const ZERO_WIDTH_CODES = [0x200b, 0x200d, 0xfe0f];
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2600, 0x27bf],
  [0x2b50, 0x2b50],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f1e6, 0x1f1ff],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];
const COMBINING_MARK = /\p{M}/u;

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (ZERO_WIDTH_CODES.includes(code) || COMBINING_MARK.test(char)) return 0;
  return WIDE_RANGES.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
}

// Corta en el primer límite de carácter que cabe en `max` columnas (al menos un carácter para avanzar)
export function splitAtWidth(text: string, max: number): [string, string, number] {
  let head = '';
  let used = 0;
  for (const char of text) {
    const size = charWidth(char);
    if (head && used + size > max) break;
    head += char;
    used += size;
  }
  return [head, text.slice(head.length), used];
}

export const textWidth = (text: string): number => [...text].reduce((total, char) => total + charWidth(char), 0);

const spansWidth = (spans: Span[]): number => spans.reduce((total, span) => total + textWidth(span.text), 0);

export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  const text = line.trim();
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith(ESCAPED_PIPE, i)) {
      current += CELL_SEPARATOR;
      i += 1;
    } else if (text[i] === CODE_TICK) {
      inCode = !inCode;
      current += text[i];
    } else if (text[i] === CELL_SEPARATOR && !inCode) {
      cells.push(current.trim());
      current = '';
    } else current += text[i];
  }
  cells.push(current.trim());
  if (text.startsWith(CELL_SEPARATOR)) cells.shift();
  if (text.endsWith(CELL_SEPARATOR) && !text.endsWith(ESCAPED_PIPE)) cells.pop();
  return cells;
}

export function isDelimiterRow(line: string): boolean {
  if (!line.includes(CELL_SEPARATOR)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

function alignOf(cell: string): Align {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
  return cell.endsWith(':') ? 'right' : 'left';
}

// `lines` empieza en el encabezado; la segunda línea es la fila de alineación
export function parseTable(lines: string[]): ParsedTable {
  const header = splitRow(lines[0]);
  const delimiter = splitRow(lines[1]);
  const fit = (cells: string[]) => header.map((_, index) => cells[index] ?? '');
  return {
    header,
    aligns: fit(delimiter).map((cell) => (DELIMITER_CELL.test(cell) ? alignOf(cell) : 'left')),
    rows: lines.slice(2).map((line) => fit(splitRow(line))),
  };
}

type Style = Omit<Span, 'text'>;
interface Word {
  text: string;
  style: Style;
  // Pegada a la palabra anterior: no había espacio entre ambas en el original
  glued: boolean;
}

function wordsOf(spans: Span[]): Word[] {
  const words: Word[] = [];
  let pendingSpace = true;
  for (const { text, ...style } of spans) {
    for (const part of text.split(/(\s+)/).filter(Boolean)) {
      if (/^\s+$/.test(part)) {
        pendingSpace = true;
        continue;
      }
      words.push({ text: part, style, glued: !pendingSpace });
      pendingSpace = false;
    }
  }
  return words;
}

function chunkWord(word: Word, width: number): Word[] {
  const chunks: Word[] = [];
  let current = '';
  for (const char of word.text) {
    if (current && textWidth(current) + charWidth(char) > width) {
      chunks.push({ text: current, style: word.style, glued: false });
      current = '';
    }
    current += char;
  }
  return [...chunks, { text: current, style: word.style, glued: false }];
}

// Ajuste por palabras midiendo ancho real; una palabra más larga que la celda se corta
export function wrapCell(spans: Span[], width: number): Span[][] {
  const lines: Span[][] = [];
  let line: Span[] = [];
  let used = 0;
  const flush = () => {
    lines.push(line);
    line = [];
    used = 0;
  };
  for (const word of wordsOf(spans)) {
    for (const [index, piece] of chunkWord(word, width).entries()) {
      const size = textWidth(piece.text);
      const glued = index === 0 && word.glued;
      if (line.length && used + (glued ? 0 : 1) + size > width) flush();
      const gap = line.length && !glued ? ' ' : '';
      line.push({ ...piece.style, text: `${gap}${piece.text}` });
      used += size + gap.length;
    }
  }
  if (line.length || !lines.length) flush();
  return lines;
}

// Reparte el ancho: el natural si cabe; si no, el mínimo de cada columna y el sobrante a quien más lo necesita; null si ni el mínimo cabe
export function fitColumns(natural: number[], minimum: number[], budget: number): number[] | null {
  if (natural.reduce((a, b) => a + b, 0) <= budget) return natural;
  const widths = [...minimum];
  let extra = budget - widths.reduce((a, b) => a + b, 0);
  if (extra < 0) return null;
  while (extra > 0) {
    let best = -1;
    widths.forEach((width, index) => {
      if (width < natural[index] && (best < 0 || natural[index] - width > natural[best] - widths[best])) best = index;
    });
    if (best < 0) break;
    widths[best] += 1;
    extra -= 1;
  }
  return widths;
}

const dim = (text: string): Span => ({ text, dim: true });

function padCell(line: Span[], width: number, align: Align): Span[] {
  const gap = Math.max(0, width - spansWidth(line));
  const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0;
  return [{ text: ' '.repeat(left) }, ...line, { text: ' '.repeat(gap - left) }];
}

function edge(widths: number[], left: string, middle: string, right: string): MdRow {
  return { spans: [dim(left + widths.map((w) => '─'.repeat(w + CELL_PADDING)).join(middle) + right)] };
}

function renderLine(cells: Span[][][], widths: number[], aligns: Align[], index: number): MdRow {
  const spans: Span[] = [dim('│')];
  cells.forEach((cell, column) => {
    spans.push({ text: ' ' }, ...padCell(cell[index] ?? [], widths[column], aligns[column]), { text: ' ' }, dim('│'));
  });
  return { spans };
}

function renderCells(cells: Span[][], widths: number[], aligns: Align[], bold: boolean): MdRow[] {
  const wrapped = cells.map((cell, column) =>
    wrapCell(bold ? cell.map((span) => ({ ...span, bold: true })) : cell, widths[column]),
  );
  const height = Math.max(...wrapped.map((cell) => cell.length));
  return Array.from({ length: height }, (_, index) => renderLine(wrapped, widths, aligns, index));
}

const joinWith = (cells: Span[][], separator: string): Span[] =>
  cells.flatMap((cell, index): Span[] => (index ? [{ text: separator }, ...cell] : cell));

function cardRows(spans: Span[], indent: string, width: number): MdRow[] {
  return wrapCell(spans, Math.max(1, width - indent.length)).map((line): MdRow => ({
    spans: [{ text: indent }, ...line],
  }));
}

// Ficha para ventanas angostas: «T1 · título» y debajo los pares encabezado valor
function renderCard(header: Span[][], row: Span[][], width: number): MdRow[] {
  const [first, second] = row;
  const title: Span[] = [
    ...first.map((span) => ({ ...span, bold: true })),
    ...(second && spansWidth(second) ? [{ text: CARD_SEPARATOR }, ...second] : []),
  ];
  const pairs = row
    .slice(CARD_TITLE_COLUMNS)
    .map((cell, index): Span[] =>
      spansWidth(cell) ? [...header[index + CARD_TITLE_COLUMNS], { text: ' ' }, ...cell] : [],
    )
    .filter((pair) => pair.length)
    .flatMap((pair, index): Span[] => (index ? [{ text: CARD_SEPARATOR }, ...pair] : pair));
  return [...cardRows(title, '', width), ...(pairs.length ? cardRows(pairs, CARD_INDENT, width) : [])];
}

export function renderTable(table: StyledTable, width: number): MdRow[] {
  const all = [table.header, ...table.rows];
  const columns = table.header.length;
  const natural = table.header.map((_, column) => Math.max(1, ...all.map((row) => spansWidth(row[column]))));
  const minimum = table.header.map((_, column) => {
    const longest = Math.max(1, ...all.flatMap((row) => wordsOf(row[column]).map((word) => textWidth(word.text))));
    return Math.min(natural[column], Math.max(MIN_COLUMN_WIDTH, Math.min(longest, WORD_WIDTH_CAP)));
  });
  const budget = width - (columns * (CELL_PADDING + BORDER_EXTRA) + BORDER_EXTRA);
  const widths = fitColumns(natural, minimum, budget);
  if (!widths) {
    if (!table.rows.length) return cardRows(joinWith(table.header, CARD_SEPARATOR), '', width);
    return table.rows.flatMap((row, index) => [
      ...(index ? [{ spans: [] }] : []),
      ...renderCard(table.header, row, width),
    ]);
  }
  return [
    edge(widths, '┌', '┬', '┐'),
    ...renderCells(table.header, widths, table.aligns, true),
    edge(widths, '├', '┼', '┤'),
    ...table.rows.flatMap((row) => renderCells(row, widths, table.aligns, false)),
    edge(widths, '└', '┴', '┘'),
  ];
}

// Recorta con … hasta `width` columnas de pantalla y rellena con espacios a la derecha
export function fitText(text: string, width: number): string {
  let out = '';
  let used = 0;
  const limit = textWidth(text) > width ? width - ELLIPSIS.length : width;
  for (const char of text) {
    if (used + charWidth(char) > limit) break;
    out += char;
    used += charWidth(char);
  }
  const clipped = out.length < text.length ? `${out}${ELLIPSIS}` : out;
  return clipped + ' '.repeat(Math.max(0, width - textWidth(clipped)));
}
