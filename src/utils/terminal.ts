const STDIN_EVENTS = ['data', 'keypress', 'readable', 'end'];

// En Windows, si jm sigue leyendo stdin los teclazos no llegan al proceso hijo con la terminal heredada
export function releaseStdin(stdin: NodeJS.ReadStream = process.stdin): void {
  if (stdin.isTTY) stdin.setRawMode?.(false);
  for (const event of STDIN_EVENTS) stdin.removeAllListeners(event);
  stdin.pause();
}

// Tras el traspaso a claude stdin queda pausado: sin esto el proceso se vacía de eventos y termina
export function reclaimStdin(stdin: NodeJS.ReadStream = process.stdin): void {
  stdin.ref?.();
  stdin.resume();
}
