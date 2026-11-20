import { createContext, useContext, useEffect, useState } from 'react';
import { useStdout } from 'ink';
import { CLEAR_SCREEN } from '../terminal.js';
import { CHAT_DEFAULT_TERMINAL_COLUMNS, FRAME_HORIZONTAL_OVERHEAD } from '../texts.js';

export const RESIZE_DEBOUNCE_MS = 75;

export interface TerminalSize {
  columns: number | undefined;
  rows: number | undefined;
}

export const TerminalSizeContext = createContext<TerminalSize>({ columns: undefined, rows: undefined });

export const useTerminalSize = () => useContext(TerminalSizeContext);

// Columnas útiles dentro del marco (sin borde ni relleno); sin medida se asume el ancho clásico
export const innerColumns = (size: TerminalSize): number =>
  Math.max(0, (size.columns ?? CHAT_DEFAULT_TERMINAL_COLUMNS) - FRAME_HORIZONTAL_OVERHEAD);

// Al cambiar el tamaño limpia la pantalla y recién entonces publica la medida nueva, para que no queden restos del ancho anterior
export function useTrackedTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [initial] = useState<TerminalSize>({ columns: stdout?.columns, rows: stdout?.rows });
  const [size, setSize] = useState<TerminalSize>(initial);

  useEffect(() => {
    if (!stdout) return;
    let timer: NodeJS.Timeout | null = null;
    const publish = () => {
      if (stdout.isTTY) stdout.write(CLEAR_SCREEN);
      setSize({ columns: stdout.columns, rows: stdout.rows });
    };
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(publish, RESIZE_DEBOUNCE_MS);
    };
    // Al volver de claude la terminal puede reacomodarse sin avisar: se mide otra vez y solo se repinta si cambió
    timer = setTimeout(() => {
      if (stdout.columns !== initial.columns || stdout.rows !== initial.rows) publish();
    }, RESIZE_DEBOUNCE_MS);
    stdout.on('resize', onResize);
    return () => {
      if (timer) clearTimeout(timer);
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}
