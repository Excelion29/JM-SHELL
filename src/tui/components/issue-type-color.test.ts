import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueTypeColor, toPickerItem } from './issue-type-color.js';
import { ISSUE_TYPE_COLORS } from '../texts.js';

test('issueTypeColor: épica morada, historia verde, error rojo, en español o inglés', () => {
  assert.equal(issueTypeColor('Épica'), ISSUE_TYPE_COLORS.epic);
  assert.equal(issueTypeColor('Epic'), ISSUE_TYPE_COLORS.epic);
  assert.equal(issueTypeColor('Historia'), ISSUE_TYPE_COLORS.story);
  assert.equal(issueTypeColor('Story'), ISSUE_TYPE_COLORS.story);
  assert.equal(issueTypeColor('Error'), ISSUE_TYPE_COLORS.bug);
  assert.equal(issueTypeColor('Bug'), ISSUE_TYPE_COLORS.bug);
});

test('issueTypeColor: tareas, tipos desconocidos o sin tipo quedan sin color', () => {
  assert.equal(issueTypeColor('Tarea'), undefined);
  assert.equal(issueTypeColor('Task'), undefined);
  assert.equal(issueTypeColor(''), undefined);
  assert.equal(issueTypeColor(undefined), undefined);
});

test('toPickerItem separa la clave del resumen y la pinta según el tipo', () => {
  assert.deepEqual(toPickerItem({ key: 'PGC-325', summary: 'Falla', status: 'Por hacer', type: 'Error' }), {
    id: 'PGC-325',
    code: 'PGC-325',
    codeColor: ISSUE_TYPE_COLORS.bug,
    label: 'Falla',
    detail: 'Por hacer',
  });
});
