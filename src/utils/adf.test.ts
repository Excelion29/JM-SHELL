import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adfToMarkdown, markdownToAdf } from './adf';

test('markdownToAdf: párrafos separados por línea en blanco', () => {
  const doc = markdownToAdf('Primero\n\nSegundo');
  assert.equal(doc.type, 'doc');
  assert.equal(doc.version, 1);
  assert.equal(doc.content?.length, 2);
  assert.equal(doc.content?.[0].type, 'paragraph');
  assert.equal(doc.content?.[1].content?.[0].text, 'Segundo');
});

test('markdownToAdf: líneas seguidas de un párrafo llevan salto', () => {
  const paragraph = markdownToAdf('uno\ndos').content?.[0];
  assert.deepEqual(
    paragraph?.content?.map((n) => n.type),
    ['text', 'hardBreak', 'text'],
  );
});

test('markdownToAdf: listas con viñetas y numeradas', () => {
  const doc = markdownToAdf('- a\n- b\n\n1. uno\n2. dos');
  assert.deepEqual(
    doc.content?.map((n) => n.type),
    ['bulletList', 'orderedList'],
  );
  assert.equal(doc.content?.[0].content?.length, 2);
  assert.equal(doc.content?.[1].content?.[1].content?.[0].content?.[0].text, 'dos');
});

test('markdownToAdf: lista anidada por sangría', () => {
  const list = markdownToAdf('- padre\n  - hijo').content?.[0];
  const item = list?.content?.[0];
  assert.equal(item?.content?.[1].type, 'bulletList');
  assert.equal(item?.content?.[1].content?.[0].content?.[0].content?.[0].text, 'hijo');
});

test('markdownToAdf: negrita y código en línea', () => {
  const nodes = markdownToAdf('Usa **fuerte** y `code` ya').content?.[0].content ?? [];
  assert.deepEqual(
    nodes.map((n) => [n.text, n.marks?.[0]?.type ?? null]),
    [
      ['Usa ', null],
      ['fuerte', 'strong'],
      [' y ', null],
      ['code', 'code'],
      [' ya', null],
    ],
  );
});

test('markdownToAdf: bloque de código con lenguaje y títulos', () => {
  const doc = markdownToAdf('## Criterio\n\n```ts\nconst a = 1;\n```');
  assert.equal(doc.content?.[0].type, 'heading');
  assert.equal(doc.content?.[0].attrs?.level, 2);
  assert.equal(doc.content?.[1].type, 'codeBlock');
  assert.equal(doc.content?.[1].attrs?.language, 'ts');
  assert.equal(doc.content?.[1].content?.[0].text, 'const a = 1;');
});

test('markdownToAdf: texto vacío da un documento válido', () => {
  assert.deepEqual(markdownToAdf('').content, [{ type: 'paragraph', content: [] }]);
});

test('ida y vuelta con adfToMarkdown conserva párrafos, listas, negrita y código', () => {
  const markdown = 'Hola **mundo** con `x`\n\n- uno\n- dos\n\n1. a\n2. b\n\n```js\nlet z;\n```';
  assert.equal(adfToMarkdown(markdownToAdf(markdown)), markdown);
});
