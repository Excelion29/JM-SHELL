import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { MAX_ATTACHMENT_BYTES, WINDOWS_RESERVED } from './attachments';
import { describeCharts } from './excel-charts';
import { stripControlChars } from './text';

export const EXCEL_EXTENSIONS: readonly string[] = ['.xls', '.xlsx', '.xlsm'];
// Tope por llamada: Claude pide rangos chicos y vuelve a pedir si necesita más
export const EXCEL_MAX_CELLS = 2000;
// Una celda admite 32 767 caracteres: se recorta para que una respuesta no llene el contexto del chat
export const EXCEL_MAX_CELL_CHARS = 500;
export const EXCEL_MAX_OUTPUT_CHARS = 100_000;
// Un .xlsx es un zip: pocos MB comprimidos podrían expandirse a GB al abrirlo
export const EXCEL_MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
// Resultados máximos de una búsqueda: si hay más, Claude afina el texto
export const EXCEL_MAX_MATCHES = 200;
// Libros abiertos en memoria a la vez: el chat suele volver al mismo
const CACHE_MAX_ENTRIES = 2;
const CELL_SEPARATOR = ' | ';
const FORMULA_PREFIX = '=';
const TRUNCATED_MARK = '…';
const OUTPUT_TRUNCATED_NOTE = '(salida recortada: pide un rango más chico)';

// Estructura del zip (APPNOTE): fin del directorio central y cada entrada del directorio
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_EOCD_MAX_COMMENT = 0xffff;
const ZIP_EOCD_ENTRIES_OFFSET = 10;
const ZIP_EOCD_DIRECTORY_OFFSET = 16;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_CENTRAL_UNZIPPED_OFFSET = 24;
const ZIP_CENTRAL_NAME_OFFSET = 28;
const ZIP_CENTRAL_EXTRA_OFFSET = 30;
const ZIP_CENTRAL_COMMENT_OFFSET = 32;
const ZIP64_MARKER = 0xffffffff;

export interface ExcelRequest {
  file: string;
  sheet?: string;
  range?: string;
  // Lista los gráficos con sus series en vez de las celdas
  charts?: boolean;
}

export interface ExcelSearch {
  file: string;
  text: string;
}

const clean = (value: unknown): string => stripControlChars(String(value ?? ''));

const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

// Ruta real dentro de alguna de las carpetas permitidas; los enlaces se resuelven antes de comparar
export function resolveExcelPath(file: string, roots: readonly string[]): string {
  const extension = path.extname(file).toLowerCase();
  if (!EXCEL_EXTENSIONS.includes(extension))
    throw new Error(`"${clean(file)}" no es un Excel; admito ${EXCEL_EXTENSIONS.join(' ')}.`);
  // CON.xlsx, NUL.xlsx… en Windows apuntan a dispositivos, no a archivos
  if (WINDOWS_RESERVED.test(path.basename(file).split('.')[0].trim()))
    throw new Error(`"${clean(file)}" es un nombre reservado de Windows.`);
  for (const root of roots) {
    const candidate = path.resolve(root, file);
    if (!fs.existsSync(candidate)) continue;
    const realFile = fs.realpathSync(candidate);
    if (isInside(fs.realpathSync(root), realFile) && fs.statSync(realFile).isFile()) return realFile;
  }
  throw new Error(`No encontré "${clean(file)}" dentro de la carpeta del proyecto ni de las fuentes del análisis.`);
}

// Suma lo que ocupa cada entrada descomprimida, leyendo solo el directorio central del zip
export function unzippedBytes(data: Buffer): number {
  const searchFrom = Math.max(0, data.length - ZIP_EOCD_MIN_BYTES - ZIP_EOCD_MAX_COMMENT);
  let eocd = -1;
  for (let at = data.length - ZIP_EOCD_MIN_BYTES; at >= searchFrom; at--) {
    if (data.readUInt32LE(at) === ZIP_EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('El Excel está dañado: no encontré el índice del zip.');
  const entries = data.readUInt16LE(eocd + ZIP_EOCD_ENTRIES_OFFSET);
  let offset = data.readUInt32LE(eocd + ZIP_EOCD_DIRECTORY_OFFSET);
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + ZIP_CENTRAL_HEADER_BYTES > data.length || data.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE)
      throw new Error('El Excel está dañado: el índice del zip no cuadra.');
    const size = data.readUInt32LE(offset + ZIP_CENTRAL_UNZIPPED_OFFSET);
    if (size === ZIP64_MARKER) throw new Error('El Excel es demasiado grande para abrirlo.');
    total += size;
    offset +=
      ZIP_CENTRAL_HEADER_BYTES +
      data.readUInt16LE(offset + ZIP_CENTRAL_NAME_OFFSET) +
      data.readUInt16LE(offset + ZIP_CENTRAL_EXTRA_OFFSET) +
      data.readUInt16LE(offset + ZIP_CENTRAL_COMMENT_OFFSET);
  }
  return total;
}

const cache = new Map<string, { mtimeMs: number; workbook: XLSX.WorkBook }>();

const isZipData = (data: Buffer): boolean => data.length >= 4 && data.readUInt32LE(0) === ZIP_LOCAL_SIGNATURE;

// Bytes del archivo, ya comprobado su tamaño comprimido y descomprimido
function readChecked(file: string): Buffer {
  if (fs.statSync(file).size > MAX_ATTACHMENT_BYTES) throw new Error('El Excel pesa más de 20 MB; no lo abro.');
  const data = fs.readFileSync(file);
  if (isZipData(data) && unzippedBytes(data) > EXCEL_MAX_UNZIPPED_BYTES)
    throw new Error('El Excel descomprimido pasa de 200 MB; no lo abro.');
  return data;
}

function loadWorkbook(file: string): XLSX.WorkBook {
  const stat = fs.statSync(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.workbook;
  const data = readChecked(file);
  const workbook = XLSX.read(data, { type: 'buffer', cellFormula: true, cellDates: true });
  cache.delete(file);
  cache.set(file, { mtimeMs: stat.mtimeMs, workbook });
  // Map conserva el orden de inserción: el primero es el usado hace más tiempo
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return workbook;
}

const clip = (text: string): string =>
  text.length > EXCEL_MAX_CELL_CHARS ? `${text.slice(0, EXCEL_MAX_CELL_CHARS)}${TRUNCATED_MARK}` : text;

function limitOutput(lines: string[]): string {
  const text = lines.join('\n');
  return text.length > EXCEL_MAX_OUTPUT_CHARS
    ? `${text.slice(0, EXCEL_MAX_OUTPUT_CHARS)}\n${OUTPUT_TRUNCATED_NOTE}`
    : text;
}

const sheetNames = (workbook: XLSX.WorkBook): string => workbook.SheetNames.map((name) => clip(clean(name))).join(', ');

function describeSheets(workbook: XLSX.WorkBook): string {
  const lines = workbook.SheetNames.map(
    (name) => `- ${clip(clean(name))}: ${workbook.Sheets[name]?.['!ref'] ?? 'vacía'}`,
  );
  return limitOutput(['Hojas del libro (nombre: rango usado). Pide una hoja y un rango, p. ej. A1:H40.', ...lines]);
}

function cellLine(address: string, cell: XLSX.CellObject): string {
  const parts = [address, clip(clean(cell.w ?? cell.v))];
  if (cell.f) parts.push(clip(`${FORMULA_PREFIX}${clean(cell.f)}`));
  return parts.join(CELL_SEPARATOR);
}

// Celdas con contenido del rango: "dirección | valor mostrado | =fórmula"
function describeRange(workbook: XLSX.WorkBook, sheetName: string, range: string | undefined): string {
  const shownName = clip(clean(sheetName));
  // Solo hojas reales: "constructor" o "__proto__" no son hojas aunque el objeto los tenga
  if (!Object.prototype.hasOwnProperty.call(workbook.Sheets, sheetName))
    throw new Error(`No hay una hoja "${shownName}". Hojas: ${sheetNames(workbook)}.`);
  const sheet = workbook.Sheets[sheetName];
  const used = sheet['!ref'];
  if (!used) return `La hoja "${shownName}" está vacía.`;
  const bounds = XLSX.utils.decode_range(range ?? used);
  const cellCount = (bounds.e.r - bounds.s.r + 1) * (bounds.e.c - bounds.s.c + 1);
  if (!(cellCount > 0)) throw new Error(`El rango "${clip(clean(range))}" no es válido; usa el formato A1:B10.`);
  if (cellCount > EXCEL_MAX_CELLS)
    throw new Error(
      `El rango tiene ${cellCount} celdas; pide como máximo ${EXCEL_MAX_CELLS} por vez (rango usado: ${used}).`,
    );
  const lines: string[] = [];
  for (let row = bounds.s.r; row <= bounds.e.r; row++) {
    for (let column = bounds.s.c; column <= bounds.e.c; column++) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address] as XLSX.CellObject | undefined;
      if (cell && (cell.v !== undefined || cell.f)) lines.push(cellLine(address, cell));
    }
  }
  const header = `Hoja "${shownName}", rango ${XLSX.utils.encode_range(bounds)} (dirección | valor | =fórmula):`;
  return lines.length ? limitOutput([header, ...lines]) : `${header}\n(sin celdas con contenido)`;
}

function chartsOf(file: string, sheet?: string): string {
  const data = readChecked(file);
  if (!isZipData(data))
    return 'Este Excel es del formato antiguo (.xls): sus gráficos están en binario y no los puedo leer. Mira los rangos de datos de la hoja.';
  return limitOutput([describeCharts(data, sheet)]);
}

// Celdas de todas las hojas cuyo valor o fórmula contiene el texto (sin distinguir mayúsculas)
export function searchExcel(request: ExcelSearch, roots: readonly string[]): string {
  const needle = request.text.trim().toLowerCase();
  if (!needle) throw new Error('Escribe el texto a buscar.');
  const workbook = loadWorkbook(resolveExcelPath(request.file, roots));
  const lines: string[] = [];
  let total = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;
      const cell = sheet[address] as XLSX.CellObject;
      const haystack = `${String(cell.w ?? cell.v ?? '')}
${cell.f ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      total += 1;
      if (lines.length < EXCEL_MAX_MATCHES) lines.push(cellLine(`'${clip(clean(name))}'!${address}`, cell));
    }
  }
  if (!total) return `Ninguna celda contiene "${clip(clean(request.text))}".`;
  const more = total > EXCEL_MAX_MATCHES ? [`(${total} coincidencias; se muestran ${EXCEL_MAX_MATCHES}: afina el texto)`] : [];
  return limitOutput([`${total} celdas contienen "${clip(clean(request.text))}" (celda | valor | =fórmula):`, ...lines, ...more]);
}

// Sin hoja: lista las hojas. Con hoja: sus celdas (todo el rango usado o el rango pedido). Con charts: los gráficos
export function readExcel(request: ExcelRequest, roots: readonly string[]): string {
  const file = resolveExcelPath(request.file, roots);
  if (request.charts) return chartsOf(file, request.sheet);
  const workbook = loadWorkbook(file);
  if (!request.sheet) return describeSheets(workbook);
  return describeRange(workbook, request.sheet, request.range);
}
