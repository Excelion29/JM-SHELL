// ── Textos y teclas de la app ───────────────────────────────────
export const APP_NAME = 'JM-SHELL';
export const NO_PROJECT_LABEL = 'sin proyecto';

export const KEYS = {
  quit: 'q',
  newStory: 'n',
  changeProject: 'p',
  manualKey: 'k',
  manualKeyAlt: '/',
  retry: 'r',
  confirmYes: 's',
  confirmYesAlt: 'y',
  confirmNo: 'n',
} as const;

// Mismo formato que ISSUE_KEY_STRICT en src/refinement/state.ts (la isla ESM no importa CJS)
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

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
  nextStep: 'Siguiente paso: pulsa n para buscar una historia en Jira.',
  listNextStep: 'Siguiente paso: elige una historia y pulsa Enter para continuar.',
  selectedMarker: '>',
  blockLabel: 'bloque',
} as const;

export const MANUAL_KEY_TEXTS = {
  title: 'Escribir una clave',
  label: 'Clave (ej. AQ-45): ',
  invalidKey: 'Esa clave no parece válida. Usa el formato AQ-45.',
  nextStep: 'Escribe la clave y pulsa Enter. Esc para volver.',
} as const;

// Mismo valor que BROWSE_LIMIT en src/refinement/browse.ts
export const BROWSE_LIMIT = 100;
export const NO_EPIC_ID = '__no-epic__';
export const VISIBLE_ROWS = 10;
export const ROW_SEPARATOR = ' · ';

export const BROWSE_TEXTS = {
  epicsTitle: 'Épicas del proyecto',
  noEpicLabel: 'Historias sin épica',
  storiesTitle: (epic: string) => `Historias de ${epic}`,
  noEpicStoriesTitle: 'Historias sin épica',
  loadingEpics: 'Buscando épicas...',
  loadingStories: 'Buscando historias...',
  loadingProjects: 'Buscando tus proyectos...',
  emptyStories: 'No encontré historias aquí.',
  limitNote: `Mostrando los primeros ${BROWSE_LIMIT}. Usa el filtro o ${KEYS.manualKey} para escribir la clave.`,
  noMatches: 'Nada coincide con tu filtro.',
  filterLabel: 'Filtro: ',
  localMarker: (phase: string) => `[en .jm: ${phase}]`,
  epicsNextStep: 'Siguiente paso: elige una épica y pulsa Enter, o escribe para filtrar.',
  storiesNextStep: 'Siguiente paso: elige una historia y pulsa Enter para refinarla.',
  loadError: (message: string) => `No pude traer los datos de Jira: ${message}`,
  loadErrorNextStep: `Pulsa ${KEYS.retry} para reintentar o Esc para volver.`,
} as const;

export const PROJECT_TEXTS = {
  title: 'Cambiar de proyecto',
  noProjects: 'No encontré proyectos disponibles para tu usuario.',
  nextStep: 'Siguiente paso: elige un proyecto y pulsa Enter, o escribe para filtrar.',
  confirm: (from: string, to: string) => `Vas a cambiar el proyecto de ${from} a ${to}. ¿Seguro? (s/n)`,
  saving: 'Guardando tu proyecto...',
  saveError: (message: string) => `No pude guardar el proyecto: ${message}`,
  saveErrorNextStep: 'Elige otro proyecto o pulsa Esc para volver.',
} as const;

// Letras con Ctrl: las letras sueltas son texto del mensaje ("como...", "no...")
export const CHAT_KEYS = {
  deepModel: 'o',
  newSession: 'n',
  fullClaude: 't',
  newline: 'j',
} as const;

export const CHAT_VISIBLE_MIN_ROWS = 6;
// Alto que ocupan marco, encabezado, actividad, entrada y pie alrededor de la conversación
export const CHAT_CHROME_ROWS = 14;
export const CHAT_DEFAULT_TERMINAL_ROWS = 30;
export const CHAT_DEFAULT_TERMINAL_COLUMNS = 80;
export const CHAT_HORIZONTAL_MARGIN = 8;
export const CURSOR = '▌';
// Los deltas de texto se juntan y se pintan a este ritmo: pintar cada uno satura la terminal
export const STREAM_FLUSH_MS = 75;
export const MAX_CHAT_LINES = 400;

export const CHAT_MODEL_LABELS = { sonnet: 'Sonnet', haiku: 'Haiku', opus: 'Opus' } as const;

export const CHAT_TEXTS = {
  preparing: 'Preparando la historia y abriendo la conversación...',
  openError: (message: string) => `No pude abrir la conversación: ${message}`,
  openErrorNextStep: 'Pulsa Esc para volver al inicio y vuelve a intentar.',
  userLabel: 'Tú',
  assistantLabel: 'Claude',
  inputPrompt: '> ',
  thinking: 'Claude está pensando...',
  scrolledHint: 'Estás viendo mensajes anteriores. PgDn para volver al final.',
  headerBlock: 'bloque',
  tokens: (count: number) => `${count.toLocaleString('es')} tokens`,
  cost: (usd: number) => `$${usd.toFixed(2)}`,
  tooLongHint: `La conversación ya es larga. Pulsa Ctrl+${CHAT_KEYS.newSession.toUpperCase()} para seguir en una sesión nueva desde la bitácora (gasta menos).`,
  planReady: 'Plan listo. Pulsa Esc y luego r para revisarlo (llega en la parte 3).',
  activity: {
    read: (target: string) => `leyendo ${target}`,
    search: (target: string) => `buscando ${target}`,
    write: (target: string) => `escribiendo ${target}`,
    explore: 'explorando con Haiku...',
    other: (tool: string) => `trabajando con ${tool}...`,
  },
} as const;

export const FOOTER_HINTS = {
  pin: 'Enter confirmar · Ctrl+C salir',
  home: `↑↓ elegir · Enter continuar · ${KEYS.newStory} buscar en Jira · ${KEYS.changeProject} cambiar proyecto · ${KEYS.quit} salir`,
  picker: `↑↓ elegir · Enter abrir · escribe para filtrar · ${KEYS.manualKeyAlt} o ${KEYS.manualKey} clave a mano · ${KEYS.changeProject} proyecto · Esc volver`,
  filtering: '↑↓ elegir · Enter abrir · Backspace borrar · Esc limpiar filtro',
  projects: '↑↓ elegir · Enter cambiar · escribe para filtrar · Esc volver',
  status: 'Esc volver',
  chat: `Enter enviar · Ctrl+${CHAT_KEYS.newline.toUpperCase()} línea nueva · PgUp/PgDn desplazar · Ctrl+${CHAT_KEYS.deepModel.toUpperCase()} Opus · Ctrl+${CHAT_KEYS.fullClaude.toUpperCase()} Claude completo · Esc inicio`,
} as const;
