import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { EventEmitter } from 'node:events';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { Frame } from './components/frame.js';
import { RESIZE_DEBOUNCE_MS } from './components/terminal-size.js';
import { CLEAR_SCREEN, createAltScreen, ENTER_ALT_SCREEN, LEAVE_ALT_SCREEN } from './terminal.js';
import { waitFor } from './test-support.js';
import { FRAME_BOTTOM_MARGIN, FRAME_HORIZONTAL_OVERHEAD, HINT_DIVIDER_CHAR, type Hint } from './texts.js';

const ROWS = 12;
const COLUMNS = 50;
const FRAME_ROWS = ROWS - FRAME_BOTTOM_MARGIN;
// Entrar a la pantalla alternativa también la limpia: al volver de claude puede traer restos
const ENTER = ENTER_ALT_SCREEN + CLEAR_SCREEN;

function fakeTty(isTTY: boolean) {
  const writes: string[] = [];
  return { writes, isTTY, write: (data: string) => (writes.push(data), true) } as unknown as NodeJS.WriteStream & {
    writes: string[];
  };
}

test('la pantalla alternativa se abre y se cierra una sola vez, y deja de escuchar al salir', () => {
  const stdout = fakeTty(true);
  const exitListeners = process.listenerCount('exit');
  const screen = createAltScreen(stdout);
  screen.enter();
  screen.enter();
  assert.equal(process.listenerCount('exit'), exitListeners + 1);
  screen.leave();
  screen.leave();
  assert.deepEqual(stdout.writes, [ENTER, LEAVE_ALT_SCREEN]);
  assert.equal(process.listenerCount('exit'), exitListeners);
});

test('la pantalla alternativa se puede volver a abrir tras el traspaso a claude', () => {
  const stdout = fakeTty(true);
  const screen = createAltScreen(stdout);
  screen.enter();
  screen.leave();
  screen.enter();
  screen.leave();
  assert.deepEqual(stdout.writes, [ENTER, LEAVE_ALT_SCREEN, ENTER, LEAVE_ALT_SCREEN]);
});

test('también engancha unhandledRejection mientras está abierta y lo suelta al salir', () => {
  const screen = createAltScreen(fakeTty(true));
  const before = process.listenerCount('unhandledRejection');
  screen.enter();
  assert.equal(process.listenerCount('unhandledRejection'), before + 1);
  screen.leave();
  assert.equal(process.listenerCount('unhandledRejection'), before);
});

test('sin TTY no escribe nada', () => {
  const stdout = fakeTty(false);
  const screen = createAltScreen(stdout);
  screen.enter();
  screen.leave();
  assert.deepEqual(stdout.writes, []);
});

test('si la terminal cambió de tamaño sin avisar al montar, se vuelve a medir y se limpia', async () => {
  const instance = render(
    <Frame projectKey="AQ" hint={[{ key: '', label: 'PIE' }]}>
      <Text>contenido</Text>
    </Frame>,
  );
  const stdout = instance.stdout as unknown as { rows: number; columns: number; isTTY: boolean };
  Object.defineProperty(stdout, 'rows', { value: ROWS, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: COLUMNS, configurable: true });
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  const written: string[] = [];
  const originalWrite = instance.stdout.write.bind(instance.stdout);
  instance.stdout.write = (data: string) => (written.push(data), originalWrite(data));
  await waitFor(() => written.includes(CLEAR_SCREEN), 'la limpieza tras medir de nuevo', RESIZE_DEBOUNCE_MS * 20);
  await waitFor(() => (instance.lastFrame() ?? '').split('\n').length === FRAME_ROWS, 'el alto nuevo');
});

test('el marco ocupa la ventana menos una fila, pega el pie abajo y se ajusta al cambiar el tamaño', async () => {
  const instance = render(
    <Frame projectKey="AQ" hint={[{ key: '', label: 'PIE' }]}>
      <Text>contenido</Text>
    </Frame>,
  );
  const stdout = instance.stdout as unknown as EventEmitter & { rows: number; columns: number; isTTY: boolean };
  Object.defineProperty(stdout, 'rows', { value: ROWS, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: COLUMNS, configurable: true });
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  const written: string[] = [];
  const originalWrite = instance.stdout.write.bind(instance.stdout);
  instance.stdout.write = (data: string) => (written.push(data), originalWrite(data));
  stdout.emit('resize');
  await waitFor(() => written.includes(CLEAR_SCREEN), 'la limpieza al cambiar el tamaño', RESIZE_DEBOUNCE_MS * 20);
  await waitFor(() => (instance.lastFrame() ?? '').split('\n').length === FRAME_ROWS, 'el alto exacto');
  const lines = (instance.lastFrame() ?? '').split('\n');
  assert.equal(lines.length, FRAME_ROWS);
  assert.ok(lines[FRAME_ROWS - 2].includes('PIE'));
  assert.ok(lines.every((line) => line.length <= COLUMNS));
});

const LEGEND_COLUMNS = 40;
const LEGEND: Hint = [
  { key: '↑↓', label: 'moverte' },
  { key: 'Ctrl+N', label: 'línea nueva' },
  { key: 'Enter', label: 'continuar' },
  { key: 'Esc', label: 'inicio' },
];

// El borde del marco también usa ─: la divisoria es la que va dentro del borde lateral
const isDivider = (line: string): boolean => line.includes(`│ ${HINT_DIVIDER_CHAR}`);

async function renderNarrowFrame(hint: Hint, columns: number): Promise<string[]> {
  const instance = render(
    <Frame projectKey="AQ" hint={hint}>
      <Text>contenido</Text>
    </Frame>,
  );
  const stdout = instance.stdout as unknown as EventEmitter & { rows: number; columns: number; isTTY: boolean };
  Object.defineProperty(stdout, 'rows', { value: ROWS, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: columns, configurable: true });
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  stdout.emit('resize');
  await waitFor(
    () => (instance.lastFrame() ?? '').split('\n')[0]?.length === columns,
    'el ancho nuevo',
    RESIZE_DEBOUNCE_MS * 20,
  );
  return (instance.lastFrame() ?? '').split('\n');
}

test('la leyenda pinta una línea divisoria del ancho interno y cada tecla con su acción', async () => {
  const lines = await renderNarrowFrame(LEGEND, COLUMNS);
  const dividerIndex = lines.findIndex((line) => isDivider(line));
  assert.ok(dividerIndex >= 0, lines.join('\n'));
  assert.ok(lines[dividerIndex].includes(HINT_DIVIDER_CHAR.repeat(COLUMNS - FRAME_HORIZONTAL_OVERHEAD)));
  const legend = lines.slice(dividerIndex + 1).join('\n');
  for (const item of LEGEND) assert.ok(legend.includes(`${item.key} ${item.label}`), legend);
});

test('en un ancho angosto la leyenda salta de línea solo entre ítems', async () => {
  const lines = await renderNarrowFrame(LEGEND, LEGEND_COLUMNS);
  const dividerIndex = lines.findIndex((line) => isDivider(line));
  const legendLines = lines.slice(dividerIndex + 1);
  assert.ok(legendLines.filter((line) => /[a-zñ]/.test(line)).length > 1, legendLines.join('\n'));
  for (const item of LEGEND)
    assert.ok(
      legendLines.some((line) => line.includes(`${item.key} ${item.label}`)),
      legendLines.join('\n'),
    );
});

test('sin ítems no pinta la línea divisoria', async () => {
  const lines = await renderNarrowFrame([], COLUMNS);
  assert.ok(!lines.some((line) => isDivider(line)), lines.join('\n'));
});
