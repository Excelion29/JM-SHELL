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
  review: 'r',
  closeStory: 'x',
  edit: 'e',
  detail: 'd',
  attachments: 'a',
  create: 'c',
  changeAssignee: 'a',
  toggle: ' ',
  open: 'o',
  selectFolder: 's',
} as const;

// Mismo formato que ISSUE_KEY_STRICT en src/refinement/state.ts (la isla ESM no importa CJS)
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

export const COLORS = {
  brand: 'cyan',
  accent: 'green',
  error: 'red',
  muted: 'gray',
  code: 'yellow',
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
export const MESSAGE_INDENT = 2;
export const CONTEXT_K = 1000;
export const CURSOR = '▌';
// Los deltas de texto se juntan y se pintan a este ritmo: pintar cada uno satura la terminal
export const STREAM_FLUSH_MS = 75;
// Mensajes (no filas) que el chat conserva en pantalla: cubre la copia local completa (500)
export const MAX_CHAT_LINES = 2000;

export const CHAT_MODEL_LABELS = { sonnet: 'Sonnet', haiku: 'Haiku', opus: 'Opus' } as const;

export const CHAT_TEXTS = {
  preparing: 'Preparando la historia y abriendo la conversación...',
  openError: (message: string) => `No pude abrir la conversación: ${message}`,
  openErrorNextStep: 'Pulsa Esc para volver al inicio y vuelve a intentar.',
  userLabel: 'Tú',
  codeFolderLine: (folder: string) => `código: ${folder}`,
  assistantLabel: 'Claude',
  inputPrompt: '> ',
  thinking: 'Claude está pensando...',
  scrolledHint: 'Estás viendo mensajes anteriores. PgDn para volver al final.',
  headerBlock: 'bloque',
  context: (tokens: number) => `contexto ${tokens >= CONTEXT_K ? `${Math.round(tokens / CONTEXT_K)}k` : tokens}`,
  cost: (usd: number) => `$${usd.toFixed(2)}`,
  tooLongHint: `La conversación ya es larga. Pulsa Ctrl+${CHAT_KEYS.newSession.toUpperCase()} para seguir en una sesión nueva desde la bitácora (gasta menos).`,
  planReady: `Plan listo. Pulsa Esc y luego ${KEYS.review} para revisarlo.`,
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
  home: `↑↓ elegir · Enter continuar · ${KEYS.newStory} buscar en Jira · ${KEYS.changeProject} cambiar proyecto · ${KEYS.review} revisar plan · ${KEYS.closeStory} cerrar historia · ${KEYS.quit} salir`,
  picker: `↑↓ elegir · Enter abrir · escribe para filtrar · ${KEYS.manualKeyAlt} o ${KEYS.manualKey} clave a mano · ${KEYS.changeProject} proyecto · Esc volver`,
  filtering: '↑↓ elegir · Enter abrir · Backspace borrar · Esc limpiar filtro',
  projects: '↑↓ elegir · Enter cambiar · escribe para filtrar · Esc volver',
  status: 'Esc volver',
  review: `↑↓ moverte · espacio marcar · ${KEYS.edit} editar · ${KEYS.detail} detalle · ${KEYS.attachments} adjuntos · ${KEYS.create} crear en Jira · Esc inicio`,
  edit: '↑↓ o Tab cambiar de campo · Enter siguiente o guardar · Esc cancelar',
  files: `↑↓ elegir · espacio cambiar propósito · Enter tareas · ${KEYS.open} abrir · Esc volver`,
  fileTasks: '↑↓ elegir · espacio asignar o quitar · Esc volver',
  detail: 'Esc volver',
  createAsk: '↑↓ elegir · Enter confirmar · Esc volver',
  createConfirm: `${KEYS.confirmYes} crear · ${KEYS.changeAssignee} cambiar responsable · Esc cancelar`,
  createRunning: 'Creando en Jira... no cierres la consola.',
  createDone: `${KEYS.open} abrir el padre en el navegador · Esc inicio`,
  createFailed: `${KEYS.retry} reintentar · Esc volver`,
  assignee: '↑↓ elegir · Enter cambiar · escribe para filtrar · Esc volver',
  close: `${KEYS.confirmYes} confirmar · cualquier otra tecla cancela`,
  closed: 'Esc inicio',
  choose: (count: number) => `1-${count} elegir`,
  knowledge: 'Esc cancelar',
  knowledgeBrowse: `↑↓ elegir · Enter abrir carpeta o nota · Backspace subir · ${KEYS.selectFolder} elegir esta carpeta · Esc cancelar`,
  chat: `Enter enviar · PgUp/PgDn o ↑↓ leer · Ctrl+${CHAT_KEYS.newline.toUpperCase()} línea · Ctrl+${CHAT_KEYS.deepModel.toUpperCase()} Opus · Ctrl+${CHAT_KEYS.fullClaude.toUpperCase()} Claude completo · Esc inicio`,
} as const;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_MINUTE = 60;
export const SUMMARY_MAX_CHARS = 44;
export const PROGRESS_VISIBLE_LINES = 12;
export const ELLIPSIS = '…';

export const RISK_LABELS = {
  low: 'bajo',
  medium: 'medio',
  high: 'alto',
} as const;
export const RISK_COLORS = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
} as const;
// Mismo orden que ATTACHMENT_PURPOSES en src/refinement/types.ts
export const PURPOSE_CYCLE = ['analysis', 'evidence', 'team'] as const;
export const PURPOSE_LABELS = {
  analysis: 'análisis',
  evidence: 'evidencia',
  team: 'equipo',
} as const;
export const PURPOSE_HELP = {
  analysis: 'solo para el debate, no se sube',
  evidence: 'se sube a la tarea',
  team: 'se sube a la tarea para el equipo',
} as const;

export const PLAN_TEXTS = {
  title: (key: string, summary: string) => `Revisión del plan · ${key} ${summary}`,
  loading: 'Leyendo el plan...',
  empty: 'El plan no tiene tareas.',
  included: '[x]',
  excluded: '[ ]',
  total: (count: number, expected: string, deviation: string) =>
    `Total (${count} marcada(s)): esperado ${expected} · σ ${deviation}`,
  saveError: (message: string) => `No pude guardar el cambio: ${message}`,
  noneIncluded: 'Marca al menos una tarea para crearla en Jira.',
  nextStep: `Siguiente paso: marca lo que quieres crear y pulsa ${'c'}.`,
  editTitle: (id: string) => `Editar ${id}`,
  emptySummary: 'El título no puede quedar vacío.',
  fields: {
    summary: 'Título',
    optimistic: 'Optimista (O)',
    likely: 'Probable (M)',
    pessimistic: 'Pesimista (P)',
  },
  preview: (expected: string, deviation: string) => `esperado ${expected} · σ ${deviation}`,
  detailTitle: (id: string, summary: string) => `${id} · ${summary}`,
  detailDescription: 'Descripción',
  detailCriteria: 'Criterio de terminado',
  detailRationale: 'Por qué esta estimación',
  detailAttachments: 'Adjuntos',
  none: 'Ninguno.',
  filesTitle: 'Adjuntos de la historia',
  noFiles: 'No hay archivos en la carpeta de adjuntos.',
  fileTasksTitle: (file: string) => `¿A qué tareas va ${file}?`,
  noTasksAssigned: 'sin tarea',
  filesNextStep: 'Evidencia y equipo se suben a las tareas que elijas; análisis se queda local.',
  openError: (message: string) => `No pude abrir el archivo: ${message}`,
} as const;

export const CREATE_TEXTS = {
  title: 'Crear en Jira',
  loading: 'Revisando el padre y el responsable...',
  askReasons: {
    epic: (key: string) => `${key} es una épica: no admite subtareas.`,
    subtask: (key: string) => `${key} es una subtarea: no admite tareas dentro.`,
    done: (key: string) => `${key} ya está cerrada.`,
    'not-found': (key: string) => `No encontré ${key} en Jira.`,
  },
  askQuestion: '¿Dónde creo las tareas?',
  askEpic: (key: string, summary: string | null) =>
    `Dentro de la épica ${key}${summary ? ` (${summary})` : ''} como issues estándar`,
  askOther: 'Dentro de otra clave',
  askCancel: 'Cancelar',
  otherChecking: 'Revisando esa clave...',
  otherError: (message: string) => `Esa clave no sirve: ${message}`,
  confirmTitle: 'Confirma antes de crear',
  tasks: (count: number, expected: string) => `${count} tarea(s) · esperado total ${expected}`,
  parent: (key: string, summary: string) => `Padre: ${key} · ${summary}`,
  type: (name: string) => `Tipo: ${name}`,
  assignee: (name: string) => `Responsable: ${name}`,
  uploads: (count: number) => `Adjuntos a subir: ${count}`,
  uploadLine: (file: string, purpose: string, tasks: string) => `  ${file} (${purpose}) → ${tasks}`,
  existingHeader: 'Ya existen en Jira con el mismo título (se vincularán, no se crearán):',
  existingLine: (key: string, summary: string) => `  ${key} · ${summary}`,
  confirmNextStep: `Siguiente paso: pulsa ${KEYS.confirmYes} para crear.`,
  assigneeTitle: 'Cambiar responsable (para todas las tareas)',
  assigneeLoading: 'Buscando usuarios...',
  progress: {
    creating: 'creando...',
    created: 'creada',
    existing: 'ya existía, no la repito',
    uploading: 'subiendo',
    uploaded: 'subido',
  },
  line: (index: number, total: number, summary: string, state: string) => `[${index}/${total}] ${summary} · ${state}`,
  doneTitle: 'Listo, tareas creadas',
  doneLine: (key: string, summary: string, existing: boolean) => `${key} · ${summary}${existing ? ' (ya estaba)' : ''}`,
  estimateSkipped: 'Jira no acepta estimación en este proyecto: se crearon sin ella.',
  doneNextStep: (parentKey: string) => `Siguiente paso: pulsa o para abrir ${parentKey} en Jira.`,
  openError: (message: string) => `No pude abrir el navegador: ${message}`,
  failedTitle: 'Se cortó la creación',
  failedKept: (count: number) => `Se conservó lo hecho (${count} tarea(s)).`,
  failedNextStep: `Siguiente paso: pulsa ${KEYS.retry} para continuar donde se cortó.`,
} as const;

export const CLOSE_TEXTS = {
  title: (key: string) => `Cerrar ${key}`,
  loading: 'Verificando tus adjuntos en Jira...',
  deleteHeader: 'Se eliminarán de tu carpeta:',
  keepHeader: 'Se conservan:',
  fileLine: (file: string, reason: string) => `  ${file} · ${reason}`,
  nothing: '  nada',
  question: `Pulsa ${KEYS.confirmYes} para eliminar y cerrar la historia. Cualquier otra tecla cancela y no borra nada.`,
  working: 'Eliminando y cerrando...',
  closeError: (message: string) => `No pude cerrar la historia: ${message}`,
  doneTitle: 'Historia cerrada',
  doneDeleted: (count: number) => `Se eliminaron ${count} archivo(s).`,
  doneKept: (count: number) => `Quedaron ${count} archivo(s) en tu carpeta.`,
  doneNextStep: 'Siguiente paso: vuelve al inicio con Esc.',
} as const;

export const KNOWLEDGE_DEFAULT_URL_EXAMPLE = 'https://127.0.0.1:27124/mcp';

export const KNOWLEDGE_TEXTS = {
  title: 'Base de conocimiento',
  question: '¿Conecto una base de conocimiento a esta carpeta?',
  questionHint: 'Claude la lee al refinar y deja ahí las decisiones de cada historia.',
  options: {
    mcp: 'MCP (por ejemplo Obsidian Local REST API)',
    local: 'Carpeta local de esta PC',
    none: 'Ninguna (no vuelvo a preguntar en esta carpeta)',
  },
  kindNextStep: 'Siguiente paso: elige una opción y pulsa Enter.',
  kindKeysHint: '1-3 o ↑↓ elegir',
  routing: 'Preparando…',
  urlLabel: 'URL del MCP: ',
  urlNextStep: 'Escribe la URL (https) y pulsa Enter.',
  keyLabel: 'API key: ',
  keyNextStep: 'Pega la API key y pulsa Enter. Se guarda cifrada con tu PIN, nunca en el .jira.json.',
  rootLabel: 'Carpeta raíz: ',
  rootNextStep: 'Escribe la ruta completa de la carpeta y pulsa Enter.',
  inputEmpty: 'Este dato no puede quedar vacío.',
  checking: 'Conectando con el servidor...',
  saving: 'Guardando...',
  trustTitle: 'Este servidor usa un certificado propio',
  trustFingerprint: (fingerprint: string) => `Huella SHA-256: ${fingerprint}`,
  trustQuestion: `¿Confías en este servidor? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  trustNextStep: `Si la huella coincide con la de tu servidor, pulsa ${KEYS.confirmYes}; cualquier otra tecla cancela.`,
  connectError: (message: string) => `No pude conectar: ${message}`,
  saveError: (message: string) => `No pude guardar la configuración: ${message}`,
  browseTitle: (dir: string) => `Elige la carpeta base · ${dir || '/'}`,
  browseLoading: 'Leyendo la carpeta...',
  browseEmpty: 'Esta carpeta está vacía.',
  browseError: (message: string) => `No pude leer la carpeta: ${message}`,
  folderSuffix: '/',
  adrLine: (folder: string, exists: boolean) =>
    `Notas de las historias: ${folder}/ (${exists ? 'ya existe' : 'se creará al guardar la primera nota'})`,
  previewTitle: (file: string) => `Vista previa · ${file}`,
  previewBack: 'Esc o Backspace para volver a la lista.',
  previewError: (message: string) => `No pude leer la nota: ${message}`,
  confirmTitle: 'Esta carpeta trae una base de conocimiento ya configurada',
  confirmWarning: 'Viene del .jira.json: si clonaste este repositorio, revísala antes de confiar en ella.',
  confirmType: (type: 'mcp' | 'local') => `Tipo: ${type === 'mcp' ? 'MCP' : 'carpeta local'}`,
  confirmTarget: (type: 'mcp' | 'local', target: string) => `${type === 'mcp' ? 'URL' : 'Carpeta'}: ${target}`,
  confirmBase: (baseFolder: string) => `Carpeta base: ${baseFolder || '/'}`,
  confirmQuestion: `¿Confías en esta base de conocimiento? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  confirmNextStep: `Si la reconoces, pulsa ${KEYS.confirmYes} y sigo al chat; cualquier otra tecla vuelve al inicio.`,
  confirmError: (message: string) => `No pude leer la base configurada: ${message}`,
  rootNotAllowed: 'No puedes elegir la raíz de la bóveda: entra a una carpeta y pulsa de nuevo.',
  browseNextStep: `Siguiente paso: entra a la carpeta donde continuar y pulsa ${KEYS.selectFolder} para elegirla.`,
} as const;
