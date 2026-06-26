/**
 * adf.ts — Atlassian Document Format → Markdown
 *
 * Cubre los nodos más comunes en descripciones de historias de Jira.
 * Nodos no reconocidos se ignoran silenciosamente para no romper el output.
 */

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export function adfToMarkdown(doc: AdfNode | null | undefined): string {
  if (!doc) return '';
  return renderNode(doc).trim();
}

function renderNode(node: AdfNode, context: { listType?: 'bullet' | 'ordered'; depth?: number } = {}): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(n => renderNode(n, context)).filter(Boolean).join('\n\n');

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
      return (node.content ?? [])
        .map(item => renderListItem(item, '- ', context.depth ?? 0))
        .join('\n');

    case 'orderedList': {
      let i = (node.attrs?.order as number) ?? 1;
      return (node.content ?? [])
        .map(item => renderListItem(item, `${i++}. `, context.depth ?? 0))
        .join('\n');
    }

    case 'listItem': {
      // Handled by parent via renderListItem
      return (node.content ?? []).map(n => renderNode(n, context)).join('\n');
    }

    case 'blockquote':
      return (node.content ?? [])
        .map(n => renderNode(n, context))
        .join('\n')
        .split('\n')
        .map(l => `> ${l}`)
        .join('\n');

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) ?? '';
      const code = (node.content ?? []).map(n => n.text ?? '').join('');
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
        return (node.content).map(n => renderNode(n, context)).filter(Boolean).join(' ');
      }
      return '';
  }
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map(n => renderNode(n)).join('');
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
      if (rest.length) lines.push(...rest.map(l => `${indent}  ${l}`));
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
  const rows = (node.content ?? []).filter(n => n.type === 'tableRow');
  if (!rows.length) return '';

  const rendered = rows.map(row => {
    const cells = (row.content ?? []).map(cell => {
      const text = (cell.content ?? []).map(n => renderNode(n)).join(' ').replace(/\n/g, ' ').trim();
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
      case 'strong':    result = `**${result}**`; break;
      case 'em':        result = `*${result}*`;   break;
      case 'code':      result = `\`${result}\``; break;
      case 'strike':    result = `~~${result}~~`; break;
      case 'underline': result = `__${result}__`; break;
      case 'link': {
        const href = (mark.attrs?.href as string) ?? '';
        if (href) result = `[${result}](${href})`;
        break;
      }
    }
  }
  return result;
}
