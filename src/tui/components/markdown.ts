// Renderizador de markdown mínimo para el chat: devuelve filas ya partidas al ancho de la terminal
import { COLORS } from '../texts.js';
import { isDelimiterRow, parseTable, renderTable, splitAtWidth, textWidth } from './table.js';

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  color?: string;
}

export interface MdRow {
  spans: Span[];
}

export interface MdResult {
  rows: MdRow[];
  // Opciones numeradas de la pregunta resaltada, en texto plano
  choices: string[];
}

const QUESTION_BAR = '┃ ';
const QUOTE_BAR = '│ ';
const CODE_BAR = '│ ';
const RULE_CHAR = '─';
const BULLET_CHAR = '•';
const MIN_BODY_WIDTH = 8;
const BOX_MAX_WIDTH = 40;
const MAX_QUOTE_DEPTH = 8;
const BOX_EDGE_OVERHEAD = 4;

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|/;
const CONTINUATION = /^\s+\S/;
const QUESTION_START = /^\*\*Pregunta:?\*\*:?/;
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]{1,200})\]\([^)]{0,500}\)/g;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) spans.push({ text: text.slice(last, at) });
    const [, bold, boldAlt, italic, code, link] = match;
    if (bold ?? boldAlt) spans.push({ text: (bold ?? boldAlt) as string, bold: true });
    else if (italic) spans.push({ text: italic, italic: true });
    else if (code) spans.push({ text: code, color: COLORS.code });
    else spans.push({ text: link as string });
    last = at + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

export const plainText = (text: string): string =>
  parseInline(text)
    .map((span) => span.text)
    .join('');

const lengthOf = (spans: Span[]) => spans.reduce((total, span) => total + textWidth(span.text), 0);

type Style = Omit<Span, 'text'>;

function toWords(spans: Span[]): Array<{ text: string; style: Style }> {
  return spans.flatMap(({ text, ...style }) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ text: word, style })),
  );
}

// Ajuste de palabras: `first` abre la primera fila y `rest` es la sangría francesa de las demás
function wrapSpans(spans: Span[], width: number, first: Span[], rest: Span[]): MdRow[] {
  const rows: MdRow[] = [];
  let current: Span[] = [...first];
  let used = lengthOf(first);
  let hasWord = false;
  const newRow = () => {
    rows.push({ spans: current });
    current = [...rest];
    used = lengthOf(rest);
    hasWord = false;
  };
  const push = (text: string, style: Style) => {
    current.push({ text, ...style });
    used += textWidth(text);
    hasWord = true;
  };
  for (const { text, style } of toWords(spans)) {
    let word = text;
    if (hasWord && used + 1 + textWidth(word) <= width) {
      push(` ${word}`, style);
      continue;
    }
    if (hasWord) newRow();
    // Palabra más larga que la fila: se corta en trozos
    let remaining = textWidth(word);
    while (used + remaining > width) {
      const [head, tail, headWidth] = splitAtWidth(word, Math.max(1, width - used));
      push(head, style);
      word = tail;
      remaining -= headWidth;
      newRow();
    }
    push(word, style);
  }
  rows.push({ spans: current });
  return rows;
}

const blankRow = (): MdRow => ({ spans: [] });
const withBar = (rows: MdRow[], bar: Span): MdRow[] => rows.map((row) => ({ spans: [bar, ...row.spans] }));
const tint = (rows: MdRow[], color: string): MdRow[] =>
  rows.map((row) => ({ spans: row.spans.map((span) => (span.color ? span : { ...span, color })) }));

function codeBlock(lines: string[], language: string, width: number): MdRow[] {
  const inner = Math.max(MIN_BODY_WIDTH, width - CODE_BAR.length);
  const boxWidth = Math.min(width, BOX_MAX_WIDTH);
  const edge = (corner: string, label: string): MdRow => {
    const title = label ? ` ${label} ` : '';
    const fill = RULE_CHAR.repeat(Math.max(1, boxWidth - title.length - BOX_EDGE_OVERHEAD));
    return { spans: [{ text: `${corner}${RULE_CHAR}${title}${fill}`, dim: true }] };
  };
  const body = lines.flatMap((line) => {
    const chunks: string[] = [];
    for (let rest = line; rest; ) {
      const [head, tail] = splitAtWidth(rest, inner);
      chunks.push(head);
      rest = tail;
    }
    return (chunks.length ? chunks : ['']).map((chunk): MdRow => ({
      spans: [
        { text: CODE_BAR, dim: true },
        { text: chunk, color: COLORS.code },
      ],
    }));
  });
  return [edge('┌', language), ...body, edge('└', '')];
}

function tableBlock(lines: string[], width: number): MdRow[] {
  const parsed = parseTable(lines);
  return renderTable(
    {
      header: parsed.header.map(parseInline),
      aligns: parsed.aligns,
      rows: parsed.rows.map((row) => row.map(parseInline)),
    },
    width,
  );
}

// Una tabla GFM: fila con barras, fila de alineación y todas las filas con barras que siguen
function tableEnd(lines: string[], start: number): number {
  if (!TABLE_ROW.test(lines[start]) || !isDelimiterRow(lines[start + 1] ?? '')) return start;
  let end = start + 1;
  while (end + 1 < lines.length && TABLE_ROW.test(lines[end + 1])) end += 1;
  return end;
}

function numberedChoice(line: string): string[] {
  const match = NUMBERED.exec(line);
  return match ? [plainText(match[3]).trim()] : [];
}

function renderBlocks(lines: string[], width: number, depth = 0): MdResult {
  const rows: MdRow[] = [];
  const choices: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    rows.push(...wrapSpans(parseInline(paragraph.join(' ')), width, [], []));
    paragraph = [];
  };
  const blank = () => {
    if (rows.length && rows[rows.length - 1].spans.length) rows.push(blankRow());
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !FENCE.test(lines[i]); i += 1) code.push(lines[i]);
      rows.push(...codeBlock(code, fence[1], width));
    } else if (!line.trim()) {
      flush();
      blank();
    } else if (heading) {
      flush();
      rows.push(
        ...wrapSpans(
          parseInline(heading[1]).map((span) => ({ ...span, bold: true })),
          width,
          [],
          [],
        ),
      );
    } else if (RULE.test(line)) {
      flush();
      rows.push({ spans: [{ text: RULE_CHAR.repeat(Math.min(width, BOX_MAX_WIDTH)), dim: true }] });
    } else if (depth < MAX_QUOTE_DEPTH && QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i += 1) inner.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
      i -= 1;
      const isQuestion = QUESTION_START.test(inner[0].trim());
      const bar = isQuestion ? QUESTION_BAR : QUOTE_BAR;
      const color = isQuestion ? COLORS.accent : COLORS.muted;
      const body = renderBlocks(inner, Math.max(MIN_BODY_WIDTH, width - bar.length), depth + 1);
      rows.push(...withBar(tint(body.rows, color), { text: bar, color }));
      if (isQuestion) choices.push(...inner.flatMap(numberedChoice));
    } else if (bullet || numbered) {
      flush();
      // La sangría no puede comerse el ancho: tope en la mitad
      const indent = ((bullet ?? numbered)?.[1] ?? '').slice(0, Math.floor(width / 2));
      let text = (bullet ? bullet[2] : numbered?.[3]) as string;
      // Líneas de continuación sangradas pertenecen al mismo ítem
      while (
        i + 1 < lines.length &&
        CONTINUATION.test(lines[i + 1]) &&
        !BULLET.test(lines[i + 1]) &&
        !NUMBERED.test(lines[i + 1])
      ) {
        i += 1;
        text += ` ${lines[i].trim()}`;
      }
      const lead = `${indent}${bullet ? BULLET_CHAR : `${numbered?.[2]}.`} `;
      rows.push(...wrapSpans(parseInline(text), width, [{ text: lead }], [{ text: ' '.repeat(lead.length) }]));
    } else if (tableEnd(lines, i) > i) {
      flush();
      const end = tableEnd(lines, i);
      rows.push(...tableBlock(lines.slice(i, end + 1), width));
      i = end;
    } else if (TABLE_ROW.test(line)) {
      flush();
      rows.push(...wrapSpans(parseInline(line.trim()), width, [], []));
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  while (rows.length && !rows[rows.length - 1].spans.length) rows.pop();
  return { rows, choices };
}

export function renderMarkdown(text: string, width: number): MdResult {
  return renderBlocks(text.replace(/\r/g, '').split('\n'), Math.max(MIN_BODY_WIDTH, width));
}
