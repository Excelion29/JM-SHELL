import { createContext, useContext, useEffect, useState } from 'react';
import { useStdout } from 'ink';
import { CLEAR_SCREEN } from '../terminal.js';

export const RESIZE_DEBOUNCE_MS = 75;

export interface TerminalSize {
  columns: number | undefined;
  rows: number | undefined;
}

export const TerminalSizeContext = createContext<TerminalSize>({ columns: undefined, rows: undefined });

export const useTerminalSize = () => useContext(TerminalSizeContext);

// Al cambiar el tamaño limpia la pantalla y recién entonces publica la medida nueva, para que no queden restos del ancho anterior
export function useTrackedTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>({ columns: stdout?.columns, rows: stdout?.rows });

  useEffect(() => {
    if (!stdout) return;
    let timer: NodeJS.Timeout | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (stdout.isTTY) stdout.write(CLEAR_SCREEN);
        setSize({ columns: stdout.columns, rows: stdout.rows });
      }, RESIZE_DEBOUNCE_MS);
    };
    stdout.on('resize', onResize);
    return () => {
      if (timer) clearTimeout(timer);
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}
