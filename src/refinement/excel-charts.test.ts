import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { describeCharts } from './excel-charts';

interface ContainerWriter {
  utils: { cfb_new: () => unknown; cfb_add: (container: unknown, name: string, content: Buffer) => void };
  write: (container: unknown, options: { fileType: 'zip'; type: 'buffer' }) => Buffer;
}
const containers = (XLSX as unknown as { CFB: ContainerWriter }).CFB;

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (id: string, type: string, target: string) =>
  `<Relationships><Relationship Id="${id}" Type="${REL_BASE}/${type}" Target="${target}"/></Relationships>`;

// Libro mínimo: hoja → dibujo → gráfico de dispersión con una serie por rango y otra con valores fijos
function workbookWithChart(): Buffer {
  const container = containers.utils.cfb_new();
  const parts: Record<string, string> = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Potencia &amp; 0.45" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': rels('rId1', 'worksheet', 'worksheets/sheet1.xml'),
    'xl/worksheets/sheet1.xml': '<worksheet/>',
    'xl/worksheets/_rels/sheet1.xml.rels': rels('rId1', 'drawing', '../drawings/drawing1.xml'),
    'xl/drawings/drawing1.xml': '<wsDr/>',
    'xl/drawings/_rels/drawing1.xml.rels': rels('rId1', 'chart', '../charts/chart1.xml'),
    'xl/charts/chart1.xml':
      '<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Curva 0.45</a:t></a:r></a:p></c:rich></c:tx></c:title>' +
      '<c:plotArea><c:scatterChart>' +
      "<c:ser><c:tx><c:strRef><c:f>'Potencia 0.45'!$C$1</c:f></c:strRef></c:tx>" +
      "<c:xVal><c:numRef><c:f>'Potencia 0.45'!$B$99:$B$101</c:f></c:numRef></c:xVal>" +
      "<c:yVal><c:numRef><c:f>'Potencia 0.45'!$C$99:$C$101</c:f></c:numRef></c:yVal></c:ser>" +
      '<c:ser><c:xVal><c:numLit><c:pt><c:v>0</c:v></c:pt><c:pt><c:v>4.5</c:v></c:pt></c:numLit></c:xVal></c:ser>' +
      '</c:scatterChart><c:valAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Eje X</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>' +
      '</c:plotArea></c:chart></c:chartSpace>',
  };
  for (const [name, content] of Object.entries(parts)) containers.utils.cfb_add(container, `/${name}`, Buffer.from(content));
  return containers.write(container, { fileType: 'zip', type: 'buffer' });
}

test('describeCharts sigue hoja → dibujo → gráfico y lista tipo, título y rangos de cada serie', () => {
  const text = describeCharts(workbookWithChart());
  assert.match(text, /Hoja "Potencia & 0\.45":/);
  assert.match(text, /Gráfico 1: scatterChart · "Curva 0\.45"/);
  assert.ok(!text.includes('Eje X'), 'el título de un eje no es el del gráfico');
  assert.match(text, /serie 1: nombre: 'Potencia 0\.45'!\$C\$1 · X: 'Potencia 0\.45'!\$B\$99:\$B\$101 · Y: /);
  assert.match(text, /serie 2: X: valores fijos \[0; 4\.5\]/);
});

test('describeCharts filtra por hoja y avisa si la hoja no tiene gráficos', () => {
  assert.match(describeCharts(workbookWithChart(), 'Potencia & 0.45'), /Gráfico 1/);
  assert.equal(describeCharts(workbookWithChart(), 'Otra'), 'La hoja "Otra" no tiene gráficos.');
});
