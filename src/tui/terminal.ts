export const ENTER_ALT_SCREEN = '\x1b[?1049h';
export const LEAVE_ALT_SCREEN = '\x1b[?1049l';
export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

const EXIT_CODE_SIGINT = 130;
const EXIT_CODE_SIGTERM = 143;
const EXIT_CODE_CRASH = 1;

type Output = Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;

export interface AltScreen {
  enter: () => void;
  leave: () => void;
}

// Pantalla alternativa: al salir la terminal queda como estaba. leave() es idempotente y se engancha a toda salida del proceso
export function createAltScreen(stdout: Output): AltScreen {
  let active = false;

  const leave = () => {
    if (!active) return;
    active = false;
    stdout.write(LEAVE_ALT_SCREEN);
    process.off('exit', leave);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('uncaughtException', onCrash);
    process.off('unhandledRejection', onCrash);
  };
  const onSigint = () => {
    leave();
    process.exit(EXIT_CODE_SIGINT);
  };
  const onSigterm = () => {
    leave();
    process.exit(EXIT_CODE_SIGTERM);
  };
  const onCrash = (reason: unknown) => {
    leave();
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    process.stderr.write(`${detail}\n`);
    process.exit(EXIT_CODE_CRASH);
  };

  const enter = () => {
    if (!stdout.isTTY || active) return;
    active = true;
    stdout.write(ENTER_ALT_SCREEN);
    process.on('exit', leave);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    process.on('uncaughtException', onCrash);
    process.on('unhandledRejection', onCrash);
  };

  return { enter, leave };
}
