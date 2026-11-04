// ── Textos y teclas de la app ───────────────────────────────────
export const APP_NAME = 'JM-SHELL';
export const NO_PROJECT_LABEL = 'sin proyecto';

export const KEYS = {
  quit: 'q',
  newStory: 'n',
} as const;

// Mismo formato que ISSUE_KEY_STRICT en src/refinement/state.ts (la isla ESM no importa CJS)
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export const COLORS = {
  brand: 'cyan',
  accent: 'green',
  error: 'red',
  muted: 'gray',
} as const;

export const MIN_PIN_LENGTH = 4;
export const PIN_MASK = '*';

export const PIN_TEXTS = {
  title: 'Antes de empezar',
  label: 'PIN: ',
  tooShort: `El PIN tiene al menos ${MIN_PIN_LENGTH} caracteres. Intenta de nuevo.`,
  checking: 'Comprobando tu PIN...',
  wrongPinFallback: 'No pude abrir tu configuración con ese PIN. Revisa e intenta de nuevo.',
  nextStep: 'Escribe tu PIN y pulsa Enter.',
} as const;

export const HOME_TEXTS = {
  title: 'Donde te quedaste',
  empty: 'Aún no hay historias en curso.',
  nextStep: 'Siguiente paso: pulsa n para empezar con una historia.',
  listNextStep: 'Siguiente paso: elige una historia y pulsa Enter para continuar.',
  selectedMarker: '>',
  blockLabel: 'bloque',
  newStoryTitle: 'Nueva historia',
  newStoryLabel: 'Clave (ej. AQ-45): ',
  invalidKey: 'Esa clave no parece válida. Usa el formato AQ-45.',
  newStoryNextStep: 'Escribe la clave y pulsa Enter. Esc para volver.',
} as const;

export const FOOTER_HINTS = {
  pin: 'Enter confirmar · Ctrl+C salir',
  home: `↑↓ elegir · Enter continuar · ${KEYS.newStory} nueva historia · ${KEYS.quit} salir`,
} as const;
