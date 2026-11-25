import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { EXCEL_MAX_CELLS, readExcel, searchExcel, unzippedBytes } from './excel-reader';
import { EXCEL_TOOL, handleExcelMessage } from './excel-mcp';

async function fixture(bookType: XLSX.BookType = 'xlsx'): Promise<{ root: string; file: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-excel-'));
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Tamiz', 'Pasa'],
    ['3/4"', 100],
    ['1/2"', 80],
  ]);
  sheet.C2 = { t: 'n', v: 0.9, f: 'B3/B2' };
  sheet['!ref'] = 'A1:C3';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '1');
  const file = `mezcla.${bookType}`;
  XLSX.writeFile(book, path.join(root, file), { bookType });
  return { root, file };
}

test('sin hoja lista las hojas con su rango usado', async () => {
  const { root, file } = await fixture();
  const text = readExcel({ file }, [root]);
  assert.match(text, /- 1: A1:C3/);
});

test('con hoja y rango devuelve valor y fórmula de cada celda', async () => {
  const { root, file } = await fixture();
  const text = readExcel({ file, sheet: '1', range: 'B2:C2' }, [root]);
  assert.match(text, /B2 \| 100/);
  assert.match(text, /C2 \| 0\.9 \| =B3\/B2/);
  assert.ok(!text.includes('A2'), 'fuera del rango no se lista');
});

test('lee también el formato antiguo .xls', async () => {
  const { root, file } = await fixture('biff8');
  const renamed = 'mezcla.xls';
  await fs.rename(path.join(root, file), path.join(root, renamed));
  assert.match(readExcel({ file: renamed, sheet: '1', range: 'A2' }, [root]), /A2 \| 3\/4"/);
});

test('rechaza archivos fuera de las carpetas permitidas, aunque se use ".." o ruta absoluta', async () => {
  const { root, file } = await fixture();
  const inner = path.join(root, 'proyecto');
  await fs.ensureDir(inner);
  assert.throws(() => readExcel({ file: `../${file}` }, [inner]), /No encontré/);
  assert.throws(() => readExcel({ file: path.join(root, file) }, [inner]), /No encontré/);
});

test('rechaza lo que no es Excel, hojas inexistentes y rangos demasiado grandes', async () => {
  const { root, file } = await fixture();
  assert.throws(() => readExcel({ file: 'notas.md' }, [root]), /no es un Excel/);
  assert.throws(() => readExcel({ file, sheet: 'Otra' }, [root]), /No hay una hoja "Otra"/);
  assert.throws(() => readExcel({ file, sheet: '1', range: 'A1:Z1000' }, [root]), new RegExp(`${EXCEL_MAX_CELLS}`));
});

test('el servidor MCP lista la herramienta y devuelve los errores como resultado legible', async () => {
  const { root, file } = await fixture();
  const list = handleExcelMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), [root]);
  assert.equal((list?.result as { tools: { name: string }[] }).tools[0].name, EXCEL_TOOL);
  const call = (args: Record<string, unknown>) =>
    handleExcelMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: EXCEL_TOOL, arguments: args } }),
      [root],
    )?.result as { content: { text: string }[]; isError?: boolean };
  assert.match(call({ ruta: file, hoja: '1', rango: 'C2' }).content[0].text, /=B3\/B2/);
  assert.equal(call({ ruta: 'otro.xlsx' }).isError, true);
  assert.equal(
    handleExcelMessage(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), [root]),
    null,
  );
});

test('rechaza nombres reservados de Windows y acepta nombres que empiezan con ".."', async () => {
  const { root, file } = await fixture();
  assert.throws(() => readExcel({ file: 'CON.xlsx' }, [root]), /reservado/);
  await fs.copy(path.join(root, file), path.join(root, '..informe.xlsx'));
  assert.match(readExcel({ file: '..informe.xlsx' }, [root]), /- 1: A1:C3/);
});

test('no sale por un enlace a una carpeta fuera de las permitidas', async (t) => {
  const { root, file } = await fixture();
  const inner = path.join(root, 'proyecto');
  await fs.ensureDir(inner);
  try {
    await fs.symlink(root, path.join(inner, 'afuera'), 'junction');
  } catch {
    t.skip('el sistema no permite crear el enlace');
    return;
  }
  assert.throws(() => readExcel({ file: `afuera/${file}` }, [inner]), /No encontré/);
});

test('hojas que no existen, aunque se llamen como algo del objeto, y control chars fuera de la salida', async () => {
  const { root, file } = await fixture();
  assert.throws(() => readExcel({ file, sheet: 'constructor' }, [root]), /No hay una hoja/);
  assert.throws(() => readExcel({ file, sheet: '\u001b[31mx' }, [root]), (err: Error) => !err.message.includes('\u001b'));
});

test('unzippedBytes suma lo descomprimido según el índice del zip', async () => {
  const { root, file } = await fixture();
  const data = await fs.readFile(path.join(root, file));
  assert.ok(unzippedBytes(data) > 0);
  assert.throws(() => unzippedBytes(Buffer.alloc(64)), /dañado/);
});

test('el servidor contesta error a un lote o a un pedido sin método, y no a una notificación', () => {
  const batch = handleExcelMessage('[]', []);
  assert.equal((batch?.error as { code: number }).code, -32600);
  const noMethod = handleExcelMessage(JSON.stringify({ jsonrpc: '2.0', id: 7 }), []);
  assert.equal(noMethod?.id, 7);
  const init = handleExcelMessage(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'inventada' } }),
    [],
  );
  assert.equal((init?.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
});

test('buscar_excel encuentra el texto en valores y fórmulas de todas las hojas', async () => {
  const { root, file } = await fixture();
  assert.match(searchExcel({ file, text: 'b3/' }, [root]), /1 celdas contienen "b3\/"[\s\S]*'1'!C2 \| 0\.9 \| =B3\/B2/);
  assert.match(searchExcel({ file, text: 'tamiz' }, [root]), /'1'!A1 \| Tamiz/);
  assert.match(searchExcel({ file, text: 'nada' }, [root]), /Ninguna celda/);
  assert.throws(() => searchExcel({ file, text: '  ' }, [root]), /texto a buscar/);
});

test('graficos en un .xls avisa que no se pueden leer, sin fallar', async () => {
  const { root, file } = await fixture('biff8');
  const renamed = 'viejo.xls';
  await fs.rename(path.join(root, file), path.join(root, renamed));
  assert.match(readExcel({ file: renamed, charts: true }, [root]), /formato antiguo/);
});
