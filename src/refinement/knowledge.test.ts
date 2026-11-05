import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adrNotePath,
  chooseStartMessage,
  isValidBaseFolder,
  knowledgeContextLine,
  parseKnowledgeConfig,
  resolveAdrFolder,
} from './knowledge';

test('resolveAdrFolder reusa la carpeta *JM-ADR o numera la siguiente', () => {
  assert.equal(resolveAdrFolder(['06-JM-ADR']), '06-JM-ADR');
  assert.equal(resolveAdrFolder(['01-A', '03-B', '06-JM-ADR', '09-C']), '06-JM-ADR');
  assert.equal(resolveAdrFolder(['01-A', '03-B']), '04-JM-ADR');
  assert.equal(resolveAdrFolder(['A', 'B']), '00-JM-ADR');
  assert.equal(resolveAdrFolder([]), '00-JM-ADR');
  assert.equal(resolveAdrFolder(['9-X']), '10-JM-ADR');
  assert.equal(resolveAdrFolder(['07']), '08-JM-ADR');
  assert.equal(resolveAdrFolder(['01-A', '07']), '08-JM-ADR');
});

test('adrNotePath arma la ruta con "/" y valida la clave', () => {
  assert.equal(adrNotePath('PROYECTOS/PACASMAYO', '06-JM-ADR', 'AQ-45'), 'PROYECTOS/PACASMAYO/06-JM-ADR/AQ-45.md');
  assert.equal(adrNotePath('', '00-JM-ADR', 'AQ-45'), '00-JM-ADR/AQ-45.md');
  assert.throws(() => adrNotePath('A', 'B', '../x'), /inválida/);
  assert.throws(() => adrNotePath('A', 'B', 'AQ-1/../x'), /inválida/);
});

test('chooseStartMessage decide cómo abrir la conversación', () => {
  const table: Array<[boolean, boolean, boolean, string]> = [
    [true, true, true, 'resume'],
    [true, false, false, 'resume'],
    [false, true, true, 'fromLog'],
    [false, true, false, 'fromLog'],
    [false, false, true, 'fromNote'],
    [false, false, false, 'first'],
  ];
  for (const [hasSession, hasLocalLog, noteExists, expected] of table) {
    assert.equal(chooseStartMessage({ hasSession, hasLocalLog, noteExists }), expected);
  }
});

const UNSAFE_ROOTS = [
  'relativa\\ruta',
  '\\\\servidor\\recurso',
  '\\\\?\\C:\\notas',
  '//servidor/recurso',
  'C:\\notas\\..\\otra',
  'C:\\notas\\.\\x',
  'C:\\notas\\',
];

test('parseKnowledgeConfig acepta las tres formas y rechaza lo inválido', () => {
  assert.deepEqual(parseKnowledgeConfig({ type: 'none' }), { type: 'none' });
  const mcp = { type: 'mcp', url: 'https://127.0.0.1:27124/mcp', baseFolder: 'PROYECTOS/X', tls: 'pinned' };
  assert.deepEqual(parseKnowledgeConfig(mcp), mcp);
  const local = { type: 'local', root: 'C:\\notas', baseFolder: 'PROY' };
  assert.deepEqual(parseKnowledgeConfig(local), local);
  const invalid = [
    null,
    'x',
    { type: 'otro' },
    { ...mcp, url: 'http://127.0.0.1/mcp' },
    { ...mcp, url: 'no es url' },
    { ...mcp, tls: 'off' },
    { ...mcp, baseFolder: '../fuera' },
    { ...mcp, baseFolder: '/abs' },
    { ...local, root: '' },
    { ...mcp, url: 'https://user:pass@127.0.0.1:27124/mcp' },
    { ...mcp, url: 'https://token@127.0.0.1:27124/mcp' },
    ...UNSAFE_ROOTS.map((root) => ({ ...local, root })),
  ];
  for (const bad of invalid) assert.equal(parseKnowledgeConfig(bad), null);
});

test('isValidBaseFolder rechaza .., segmentos vacíos y caracteres de control', () => {
  assert.ok(isValidBaseFolder(''));
  assert.ok(isValidBaseFolder('PROYECTOS/PACASMAYO MEZCLAS'));
  for (const bad of ['a/../b', '/a', 'a//b', 'a\\b', 'a\nb', '.']) assert.ok(!isValidBaseFolder(bad), bad);
});

test('knowledgeContextLine nombra la base y la nota; sin base no dice nada', () => {
  const mcp = { type: 'mcp', url: 'https://h/mcp', baseFolder: 'P/X', tls: 'system' } as const;
  const line = knowledgeContextLine(mcp, 'P/X/00-JM-ADR/AQ-45.md');
  assert.match(line, /jm_kb/);
  assert.match(line, /P\/X\/00-JM-ADR\/AQ-45\.md/);
  assert.equal(knowledgeContextLine({ type: 'none' }, 'x'), '');
  const local = knowledgeContextLine({ type: 'local', root: 'C:\\n', baseFolder: 'PROY' }, 'C:/n/00-JM-ADR/AQ-1.md');
  assert.match(local, /C:\\n/);
});

test('parseKnowledgeConfig rechaza una carpeta base vacía (la raíz de la bóveda)', () => {
  assert.equal(parseKnowledgeConfig({ type: 'mcp', url: 'https://h/mcp', baseFolder: '', tls: 'system' }), null);
  assert.equal(parseKnowledgeConfig({ type: 'local', root: 'C:\notas', baseFolder: '' }), null);
});
