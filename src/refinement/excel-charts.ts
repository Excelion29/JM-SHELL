import * as path from 'path';
import * as XLSX from 'xlsx';
import { stripControlChars } from './text';

// Un .xlsx guarda cada gráfico como XML: hoja → dibujo → gráfico, enlazados por los archivos _rels
const WORKBOOK_PATH = 'xl/workbook.xml';
const RELS_DIR = '_rels';
const RELS_SUFFIX = '.rels';
const DRAWING_REL = /\/drawing$/;
const CHART_REL = /\/chart$/;
const CHART_TYPE = /<(?:\w+:)?(\w+Chart)>/g;
const SERIES = /<(?:\w+:)?ser>([\s\S]*?)<\/(?:\w+:)?ser>/g;
const TITLE = /<(?:\w+:)?title>([\s\S]*?)<\/(?:\w+:)?title>/;
// Los títulos de los ejes van dentro del área del gráfico: el del gráfico está antes
const PLOT_AREA = /<(?:\w+:)?plotArea>/;
const LITERAL_VALUE = /<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/g;
// Valores fijos de una serie que se muestran como máximo (sin rango de celdas)
const MAX_LITERAL_VALUES = 12;
const TEXT_RUN = /<a:t>([^<]*)<\/a:t>/g;
const SHEET_ENTRY = /<(?:\w+:)?sheet\b[^>]*>/g;
const RELATIONSHIP = /<Relationship\b[^>]*>/g;
// Partes de una serie: nombre, categorías/valores (barras, líneas) o X/Y (dispersión)
const SERIES_PARTS = ['tx', 'cat', 'val', 'xVal', 'yVal'] as const;
const PART_LABELS: Record<(typeof SERIES_PARTS)[number], string> = {
  tx: 'nombre',
  cat: 'categorías',
  val: 'valores',
  xVal: 'X',
  yVal: 'Y',
};
// Cuántos gráficos se describen como máximo por libro
export const EXCEL_MAX_CHARTS = 60;

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]);
const clean = (text: string): string => stripControlChars(decode(text)).trim();

// SheetJS trae el lector de contenedores (zip/CFB) pero sus tipos no lo declaran
interface Container {
  FullPaths: string[];
}
interface ContainerEntry {
  content?: Uint8Array;
}
interface ContainerReader {
  read: (data: Buffer, options: { type: 'buffer' }) => Container;
  find: (container: Container, partPath: string) => ContainerEntry | null;
}
const containers = (XLSX as unknown as { CFB: ContainerReader }).CFB;

const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

function readPart(container: Container, partPath: string): string | null {
  const entry = containers.find(container, `/${partPath}`);
  return entry?.content ? Buffer.from(entry.content).toString('utf8') : null;
}

const relsPathOf = (partPath: string): string =>
  path.posix.join(path.posix.dirname(partPath), RELS_DIR, `${path.posix.basename(partPath)}${RELS_SUFFIX}`);

// Destinos de las relaciones de una parte, ya como ruta dentro del zip
function relationTargets(container: Container, partPath: string, type?: RegExp): Map<string, string> {
  const targets = new Map<string, string>();
  const rels = readPart(container, relsPathOf(partPath));
  if (!rels) return targets;
  for (const tag of rels.match(RELATIONSHIP) ?? []) {
    const id = attribute(tag, 'Id');
    const target = attribute(tag, 'Target');
    if (!id || !target || (type && !type.test(attribute(tag, 'Type') ?? ''))) continue;
    const resolved = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(partPath), target));
    targets.set(id, resolved);
  }
  return targets;
}

function describeSeries(xml: string, index: number): string {
  const parts = SERIES_PARTS.flatMap((part) => {
    const block = new RegExp(`<(?:\\w+:)?${part}>([\\s\\S]*?)</(?:\\w+:)?${part}>`).exec(xml)?.[1];
    if (!block) return [];
    const reference = /<(?:\w+:)?f>([^<]*)<\/(?:\w+:)?f>/.exec(block)?.[1];
    if (reference !== undefined) return [`${PART_LABELS[part]}: ${clean(reference)}`];
    // Sin referencia la serie trae los valores escritos en el gráfico, no en celdas
    const values = [...block.matchAll(LITERAL_VALUE)].map((match) => clean(match[1]));
    if (!values.length) return [];
    const shown = values.slice(0, MAX_LITERAL_VALUES).join('; ');
    const more = values.length > MAX_LITERAL_VALUES ? `; … (${values.length})` : '';
    return [`${PART_LABELS[part]}: valores fijos [${shown}${more}]`];
  });
  return `    - serie ${index + 1}: ${parts.join(' · ') || '(sin referencias)'}`;
}

function describeChart(xml: string, number: number): string[] {
  const types = [...new Set([...xml.matchAll(CHART_TYPE)].map((match) => match[1]))];
  const plotAreaAt = xml.search(PLOT_AREA);
  const titleBlock = TITLE.exec(plotAreaAt < 0 ? xml : xml.slice(0, plotAreaAt))?.[1] ?? '';
  const title = clean([...titleBlock.matchAll(TEXT_RUN)].map((match) => match[1]).join(''));
  const series = [...xml.matchAll(SERIES)].map((match, index) => describeSeries(match[1], index));
  return [`  Gráfico ${number}: ${types.join(' + ') || 'tipo desconocido'}${title ? ` · "${title}"` : ''}`, ...series];
}

// Gráficos de cada hoja con las series y los rangos que dibujan; solo .xlsx/.xlsm (el .xls guarda los gráficos en binario)
// onlySheet: solo los gráficos de esa hoja
export function describeCharts(data: Buffer, onlySheet?: string): string {
  const container = containers.read(data, { type: 'buffer' });
  const workbook = readPart(container, WORKBOOK_PATH);
  if (!workbook) throw new Error('No encontré el libro dentro del archivo.');
  const sheets = relationTargets(container, WORKBOOK_PATH);
  const lines: string[] = [];
  let charts = 0;
  for (const tag of workbook.match(SHEET_ENTRY) ?? []) {
    const name = clean(attribute(tag, 'name') ?? '');
    const sheetPath = sheets.get(attribute(tag, 'r:id') ?? '');
    if (!sheetPath || (onlySheet !== undefined && name !== clean(onlySheet))) continue;
    const sheetCharts: string[] = [];
    for (const drawing of relationTargets(container, sheetPath, DRAWING_REL).values()) {
      for (const chartPath of relationTargets(container, drawing, CHART_REL).values()) {
        if (charts >= EXCEL_MAX_CHARTS) break;
        const xml = readPart(container, chartPath);
        if (!xml) continue;
        charts += 1;
        sheetCharts.push(...describeChart(xml, charts));
      }
    }
    if (sheetCharts.length) lines.push(`Hoja "${name}":`, ...sheetCharts);
  }
  if (!lines.length) return onlySheet ? `La hoja "${clean(onlySheet)}" no tiene gráficos.` : 'El libro no tiene gráficos.';
  const note = charts >= EXCEL_MAX_CHARTS ? [`(se muestran los primeros ${EXCEL_MAX_CHARTS} gráficos)`] : [];
  return ['Gráficos por hoja (series con los rangos que dibujan):', ...lines, ...note].join('\n');
}
