/**
 * adf.ts — Atlassian Document Format ⇄ Markdown
 *
 * adfToMarkdown cubre los nodos más comunes en descripciones de historias de Jira;
 * los no reconocidos se ignoran para no romper el output. markdownToAdf cubre lo que
 * escribe el plan: párrafos, listas, negrita, código en línea, bloques de código y títulos.
 */

export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  version?: number;
}

export function adfToMarkdown(doc: AdfNode | null | undefined): string {
  if (!doc) return '';
  return renderNode(doc).trim();
}

function renderNode(node: AdfNode, context: { listType?: 'bullet' | 'ordered'; depth?: number } = {}): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? [])
        .map((n) => renderNode(n, context))
        .filter(Boolean)
        .join('\n\n');

    case 'paragraph':
      return renderInline(node.content ?? []);

    case 'text':
      return applyMarks(node.text ?? '', node.marks ?? []);

    case 'hardBreak':
      return '\n';

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1;
      const prefix = '#'.repeat(Math.min(level + 2, 6)); // offset: heading 1 → ###
      return `${prefix} ${renderInline(node.content ?? [])}`;
    }

    case 'bulletList':
      return (node.content ?? []).map((item) => renderListItem(item, '- ', context.depth ?? 0)).join('\n');

    case 'orderedList': {
      let i = (node.attrs?.order as number) ?? 1;
      return (node.content ?? []).map((item) => renderListItem(item, `${i++}. `, context.depth ?? 0)).join('\n');
    }

    case 'listItem': {
      // Handled by parent via renderListItem
      return (node.content ?? []).map((n) => renderNode(n, context)).join('\n');
    }

    case 'blockquote':
      return (node.content ?? [])
        .map((n) => renderNode(n, context))
        .join('\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const code = (node.content ?? []).map((n) => n.text ?? '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case 'rule':
      return '---';

    case 'inlineCard': {
      const url = (node.attrs?.url as string) ?? '';
      return url ? `[${url}](${url})` : '';
    }

    case 'mention': {
      const name = (node.attrs?.text as string) ?? (node.attrs?.id as string) ?? 'usuario';
      return `@${name}`;
    }

    case 'emoji': {
      const text = (node.attrs?.text as string) ?? '';
      return text;
    }

    case 'table':
      return renderTable(node);

    case 'mediaSingle':
    case 'media':
      return '_[adjunto]_';

    default:
      // Intentar renderizar children si los tiene
      if (node.content?.length) {
        return node.content
          .map((n) => renderNode(n, context))
          .filter(Boolean)
          .join(' ');
      }
      return '';
  }
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map((n) => renderNode(n)).join('');
}

function renderListItem(item: AdfNode, prefix: string, depth: number): string {
  const indent = '  '.repeat(depth);
  const children = item.content ?? [];

  const lines: string[] = [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (i === 0) {
      // Primera línea: el texto principal del listItem
      const text = renderNode(child, { depth });
      const firstLine = text.split('\n')[0];
      lines.push(`${indent}${prefix}${firstLine}`);
      // Resto de líneas del primer child si las hay
      const rest = text.split('\n').slice(1);
      if (rest.length) lines.push(...rest.map((l) => `${indent}  ${l}`));
    } else if (child.type === 'bulletList' || child.type === 'orderedList') {
      lines.push(renderNode(child, { depth: depth + 1 }));
    } else {
      const text = renderNode(child, { depth });
      if (text.trim()) lines.push(`${indent}  ${text}`);
    }
  }

  return lines.join('\n');
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).filter((n) => n.type === 'tableRow');
  if (!rows.length) return '';

  const rendered = rows.map((row) => {
    const cells = (row.content ?? []).map((cell) => {
      const text = (cell.content ?? [])
        .map((n) => renderNode(n))
        .join(' ')
        .replace(/\n/g, ' ')
        .trim();
      return text || ' ';
    });
    return `| ${cells.join(' | ')} |`;
  });

  // Insertar separador después del header (primera fila)
  const cols = (rows[0].content ?? []).length;
  const separator = `| ${Array(cols).fill(':---').join(' | ')} |`;
  rendered.splice(1, 0, separator);

  return rendered.join('\n');
}

function applyMarks(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>): string {
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        result = `**${result}**`;
        break;
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'underline':
        result = `__${result}__`;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) ?? '';
        if (href) result = `[${result}](${href})`;
        break;
      }
    }
  }
  return result;
}

// ── Markdown → ADF ───────────────────────────────────────────────

const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/;
const BOLD_DELIMITER_LENGTH = 2;
const LIST_INDENT_WIDTH = 2;

function inlineNodes(text: string): AdfNode[] {
  return text
    .split(INLINE_TOKEN)
    .filter(Boolean)
    .map((part): AdfNode => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > BOLD_DELIMITER_LENGTH * 2) {
        return {
          type: 'text',
          text: part.slice(BOLD_DELIMITER_LENGTH, -BOLD_DELIMITER_LENGTH),
          marks: [{ type: 'strong' }],
        };
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return { type: 'text', text: part.slice(1, -1), marks: [{ type: 'code' }] };
      }
      return { type: 'text', text: part };
    });
}

function paragraphNode(lines: string[]): AdfNode {
  const content: AdfNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    content.push(...inlineNodes(line.trim()));
  });
  return { type: 'paragraph', content };
}

interface ListLine {
  indent: number;
  ordered: boolean;
  text: string;
}

function parseListLine(line: string): ListLine | null {
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  return {
    indent: Math.floor(match[1].replace(/\t/g, '  ').length / LIST_INDENT_WIDTH),
    ordered: /\d/.test(match[2]),
    text: match[3],
  };
}

// Construye la lista anidada a partir de líneas con sangría; consume desde `from` y devuelve dónde quedó
function buildList(items: ListLine[], from: number, indent: number): { node: AdfNode; next: number } {
  const ordered = items[from].ordered;
  const children: AdfNode[] = [];
  let i = from;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      const nested = buildList(items, i, items[i].indent);
      children[children.length - 1]?.content?.push(nested.node);
      i = nested.next;
      continue;
    }
    if (items[i].ordered !== ordered) break;
    children.push({ type: 'listItem', content: [paragraphNode([items[i].text])] });
    i += 1;
  }
  return { node: { type: ordered ? 'orderedList' : 'bulletList', content: children }, next: i };
}

export function markdownToAdf(markdown: string): AdfNode {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: AdfNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line.trim());
    const heading = HEADING.exec(line);
    if (!line.trim()) {
      i += 1;
    } else if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i].trim())) code.push(lines[i++]);
      i += 1;
      const block: AdfNode = {
        type: 'codeBlock',
        content: code.length ? [{ type: 'text', text: code.join('\n') }] : [],
      };
      if (fence[1]) block.attrs = { language: fence[1] };
      blocks.push(block);
    } else if (heading) {
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineNodes(heading[2].trim()) });
      i += 1;
    } else if (parseListLine(line)) {
      const items: ListLine[] = [];
      for (let item = parseListLine(lines[i]); i < lines.length && item; item = parseListLine(lines[i] ?? '')) {
        items.push(item);
        i += 1;
      }
      const base = Math.min(...items.map((item) => item.indent));
      let at = 0;
      while (at < items.length) {
        const built = buildList(
          items.map((item) => ({ ...item, indent: item.indent - base })),
          at,
          0,
        );
        blocks.push(built.node);
        at = built.next;
      }
    } else {
      const paragraph: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !FENCE.test(lines[i].trim()) &&
        !HEADING.test(lines[i]) &&
        !parseListLine(lines[i])
      ) {
        paragraph.push(lines[i++]);
      }
      blocks.push(paragraphNode(paragraph));
    }
  }
  return { type: 'doc', version: 1, content: blocks.length ? blocks : [{ type: 'paragraph', content: [] }] };
}
