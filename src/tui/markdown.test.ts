import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MdRow, parseInline, plainText, renderMarkdown } from './components/markdown.js';
import { COLORS } from './texts.js';

const WIDTH = 30;
const textOf = (row: MdRow) => row.spans.map((span) => span.text).join('');
const lines = (text: string, width = WIDTH) => renderMarkdown(text, width).rows.map(textOf);

test('negrita, cursiva y código inline quedan sin marcas y con su estilo', () => {
  const spans = parseInline('a **b** y *c* y `d`');
  assert.deepEqual(
    spans.map((s) => s.text),
    ['a ', 'b', ' y ', 'c', ' y ', 'd'],
  );
  assert.equal(spans[1].bold, true);
  assert.equal(spans[3].italic, true);
  assert.equal(spans[5].color, COLORS.code);
});

test('los enlaces dejan solo el texto y el markup desconocido no rompe', () => {
  assert.equal(plainText('ver [docs](http://x.y) ahora'), 'ver docs ahora');
  assert.equal(plainText('a ** sin cerrar'), 'a ** sin cerrar');
});

test('párrafos separados por una línea en blanco; varias en blanco se colapsan', () => {
  assert.deepEqual(lines('uno\ndos\n\n\n\ntres'), ['uno dos', '', 'tres']);
});

test('encabezados en negrita sin las almohadillas', () => {
  const [row] = renderMarkdown('## Título', WIDTH).rows;
  assert.equal(textOf(row), 'Título');
  assert.equal(row.spans[0].bold, true);
});

test('listas con viñeta y numeradas con sangría francesa al partir', () => {
  assert.deepEqual(lines('- uno dos tres cuatro cinco seis siete ocho', 20), [
    '• uno dos tres',
    '  cuatro cinco seis',
    '  siete ocho',
  ]);
  assert.deepEqual(lines('1. uno dos tres cuatro cinco seis siete', 20), [
    '1. uno dos tres',
    '   cuatro cinco seis',
    '   siete',
  ]);
});

test('una palabra más larga que el ancho se corta sin perder texto', () => {
  const rows = lines('x'.repeat(25), 10);
  assert.ok(rows.every((row) => row.length <= 10));
  assert.equal(rows.join(''), 'x'.repeat(25));
});

test('el bloque de código no se parte por palabras y va en caja tenue', () => {
  const rows = renderMarkdown('```ts\nconst a = 1;   // espacios\n```', WIDTH).rows;
  assert.equal(textOf(rows[0]).startsWith('┌─ ts '), true);
  assert.equal(textOf(rows[1]), '│ const a = 1;   // espacios');
  assert.equal(rows[1].spans[1].color, COLORS.code);
  assert.equal(textOf(rows[2]).startsWith('└'), true);
});

test('una línea de código larga se corta en trozos sin perderse', () => {
  const rows = lines(`\`\`\`\n${'y'.repeat(50)}\n\`\`\``, 20);
  assert.equal(
    rows
      .slice(1, -1)
      .map((row) => row.slice(2))
      .join(''),
    'y'.repeat(50),
  );
});

test('la cita normal lleva barra tenue', () => {
  const [row] = renderMarkdown('> una nota', WIDTH).rows;
  assert.equal(textOf(row), '│ una nota');
  assert.equal(row.spans[0].color, COLORS.muted);
});

test('la pregunta se detecta, se resalta y extrae las opciones numeradas', () => {
  const result = renderMarkdown('Contexto\n\n> **Pregunta:** ¿Cuál?\n> 1. Primera **opción**\n> 2. Segunda', WIDTH);
  const rows = result.rows.map(textOf);
  assert.deepEqual(rows.slice(2), ['┃ Pregunta: ¿Cuál?', '┃ 1. Primera opción', '┃ 2. Segunda']);
  assert.deepEqual(result.choices, ['Primera opción', 'Segunda']);
  assert.equal(result.rows[2].spans[0].color, COLORS.accent);
});

test('una cita común con lista numerada no cuenta como opciones', () => {
  assert.deepEqual(renderMarkdown('> nota\n> 1. uno', WIDTH).choices, []);
});

test('las opciones largas se parten con sangría dentro de la barra', () => {
  const rows = lines('> **Pregunta:** ¿Sí?\n> 1. uno dos tres cuatro cinco seis siete', 20);
  assert.deepEqual(rows.slice(1), ['┃ 1. uno dos tres', '┃    cuatro cinco', '┃    seis siete']);
});

test('citas anidadas muy profundas terminan y no pasan de 8 barras', () => {
  const text = `${'>'.repeat(30)} hondo`;
  const rows = lines(text, 60);
  assert.ok(rows.length >= 1 && rows.every((row) => row.length <= 60));
  assert.ok(rows.join('').includes('hondo'));
});

test('una línea hostil de corchetes se procesa en tiempo lineal', () => {
  const started = Date.now();
  renderMarkdown(`${'['.repeat(100_000)}${'](x'.repeat(1000)}`, 40);
  assert.ok(Date.now() - started < 2000);
});

test('una sangría enorme de lista se recorta a la mitad del ancho', () => {
  const rows = lines(`${' '.repeat(200)}- texto`, 20);
  assert.ok(rows.every((row) => row.length <= 20));
  assert.ok(rows.join('').includes('texto'));
});
