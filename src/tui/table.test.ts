import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitText, parseTable, splitRow, textWidth, wrapCell } from './components/table.js';
import { MdRow, renderMarkdown } from './components/markdown.js';
import { buildTaskCells, alignCreated } from './components/task-table.js';
import { fakeTask } from './test-support.js';
import { COLORS } from './texts.js';

const textOf = (row: MdRow) => row.spans.map((span) => span.text).join('');
const render = (text: string, width: number) => renderMarkdown(text, width).rows.map(textOf);

const TABLE = '| ID | Título | O |\n|:--|---|--:|\n| T1 | Login social | 2h |\n| T2 | Pagos | 30m |';

test('mide el ancho de pantalla: acentos cuentan 1, caracteres anchos 2 y combinados 0', () => {
  assert.equal(textWidth('canción'), 7);
  assert.equal(textWidth('日本'), 4);
  assert.equal(textWidth('é'), 1);
});

test('separa celdas respetando barras escapadas y código con barras', () => {
  assert.deepEqual(splitRow('| a \\| b | `x|y` | c |'), ['a | b', '`x|y`', 'c']);
  const parsed = parseTable(['| A | B | C |', '|:--|:-:|--:|', '| 1 |']);
  assert.deepEqual(parsed.aligns, ['left', 'center', 'right']);
  assert.deepEqual(parsed.rows, [['1', '', '']]);
});

test('la tabla se dibuja con bordes, encabezado en negrita y columnas alineadas', () => {
  const result = renderMarkdown(TABLE, 40);
  const rows = result.rows.map(textOf);
  assert.deepEqual(rows, [
    '┌────┬──────────────┬─────┐',
    '│ ID │ Título       │   O │',
    '├────┼──────────────┼─────┤',
    '│ T1 │ Login social │  2h │',
    '│ T2 │ Pagos        │ 30m │',
    '└────┴──────────────┴─────┘',
  ]);
  assert.ok(result.rows[1].spans.some((span) => span.bold && span.text === 'Título'));
});

test('el texto largo se parte dentro de la celda en varias líneas sin perderse', () => {
  const rows = render('| ID | Título |\n|---|---|\n| T1 | uno dos tres cuatro cinco seis siete |', 24);
  assert.ok(rows.every((row) => textWidth(row) <= 24));
  const body = rows.slice(3, -1);
  assert.ok(body.length > 1);
  assert.equal(body.map((row) => row.split('│')[2].trim()).join(' '), 'uno dos tres cuatro cinco seis siete');
});

test('acentos y código inline alinean los bordes y el código conserva su color', () => {
  const result = renderMarkdown('| Año | Nota |\n|---|---|\n| canción | `a` y **b** |', 30);
  const rows = result.rows.map(textOf);
  assert.ok(rows.every((row) => textWidth(row) === textWidth(rows[0])));
  assert.ok(result.rows[3].spans.some((span) => span.color === COLORS.code && span.text === 'a'));
  assert.ok(rows[3].includes('a y b'));
});

test('en una ventana angosta cada fila sale como ficha con pares encabezado valor', () => {
  const wide =
    '| ID | Título | O | M | P |\n|---|---|---|---|---|\n| T1 | Login social | 2h | 3h | 5h |\n| T2 | Pagos | 1h | 2h | 3h |';
  const rows = render(wide, 14);
  assert.ok(!rows.join('').includes('┌'));
  assert.deepEqual(rows.slice(0, 3), ['T1 · Login', 'social', '  O 2h · M 3h']);
  assert.ok(rows.includes('') && rows.some((row) => row.startsWith('T2 · Pagos')));
  assert.ok(rows.every((row) => textWidth(row) <= 14));
});

test('con espacio suficiente la ficha cabe en dos líneas', () => {
  const rows = render('| ID | Título | O | M | P |\n|---|---|---|---|---|\n| T1 | Login | 2h | 3h | 5h |', 22);
  assert.deepEqual(rows, ['T1 · Login', '  O 2h · M 3h · P 5h']);
});

test('una barra suelta sin fila de alineación no es tabla y el texto previo se conserva', () => {
  assert.deepEqual(render('antes\n\n| a | b |', 30), ['antes', '', '| a | b |']);
});

test('wrapCell corta palabras más largas que la celda', () => {
  const lines = wrapCell([{ text: 'abcdefghij' }], 4).map((line) => line.map((span) => span.text).join(''));
  assert.deepEqual(lines, ['abcd', 'efgh', 'ij']);
});

test('fitText recorta con … y rellena al ancho pedido', () => {
  assert.equal(fitText('abcdefgh', 5), 'abcd…');
  assert.equal(fitText('ab', 5), 'ab   ');
  assert.equal(textWidth(fitText('canción larga', 8)), 8);
});

test('las columnas de tareas se alinean y el título cede ancho en terminales angostas', () => {
  const tasks = [fakeTask('T1', { summary: 'Corto' }), fakeTask('T2', { summary: 'x'.repeat(80) })];
  const wide = buildTaskCells(tasks, 120);
  assert.equal(wide[0].title.length, wide[1].title.length);
  assert.ok(wide[0].pert !== null);
  const narrow = buildTaskCells(tasks, 70);
  assert.equal(narrow[0].pert, null);
  assert.ok(narrow[1].title.endsWith('…'));
  const total = (c: (typeof narrow)[number]) =>
    6 + [c.id, c.title, c.jira, c.due, c.risk].reduce((n, v) => n + v.length + 2, 0);
  assert.ok(total(narrow[1]) <= 70);
});

test('las tareas creadas alinean la clave y dejan visible la nota', () => {
  const lines = alignCreated(
    [
      { key: 'AQ-9', summary: 'Uno', note: '' },
      { key: 'AQ-101', summary: 'y'.repeat(60), note: '(ya estaba)' },
    ],
    40,
  );
  assert.equal(lines[0], 'AQ-9   · Uno');
  assert.ok(lines[1].endsWith('… (ya estaba)') && textWidth(lines[1]) <= 40);
});

test('emoji de presentación, banderas y CJK miden 2 columnas; el texto con variación (⚠️) mide 1', () => {
  for (const wide of ['✅', '❌', '⭐', '🇵', '🧪', '日']) assert.equal(textWidth(wide), 2, wide);
  assert.equal(textWidth('⚠️'), 2);
  assert.equal(textWidth('🇵🇪'), 4);
});

test('spans pegados sin espacio en el original no reciben un espacio al unirse', () => {
  const lines = wrapCell([{ text: 'foo', color: 'x' }, { text: '/' }, { text: 'bar', dim: true }, { text: ': ok' }], 40);
  assert.equal(lines.map((line) => line.map((span) => span.text).join('')).join('|'), 'foo/bar: ok');
});

test('en modo ficha sin filas sigue mostrando el encabezado', () => {
  const rows = render('| Alfa muy largo | Beta muy largo | Gamma muy largo |\n|---|---|---|', 12);
  assert.ok(rows.join('\n').includes('Alfa'));
  assert.ok(rows.join('\n').includes('·'));
});

test('el texto largo se corta por columnas sin partir emoji ni desbordar con CJK', () => {
  const rows = render('日本語日本語日本語日本語', 8);
  assert.ok(rows.every((row) => textWidth(row) <= 8));
  assert.equal(rows.join(''), '日本語日本語日本語日本語');
});
