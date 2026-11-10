// ── Textos y teclas de la app ───────────────────────────────────
import type { ManagementProblem, ManagementStatus } from '../refinement/management-types.js';

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
  tasks: 't',
  start: 'i',
  myDay: 'h',
  removeTasks: 'd',
  giveBack: 'b',
  pendingFilter: 'p',
  viewPlan: 'v',
  finishDirect: 'f',
  knowledgeBase: 'b',
  calibration: 'c',
  useAdjusted: 'u',
  management: 'g',
  newAnalysis: 'a',
  addSources: 'a',
  linkAnalysis: 'v',
} as const;

// Palabra que hay que escribir completa para borrar subtareas de Jira
export const DELETE_CONFIRM_WORD = 'borrar';

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
  pickAnalysis: 'Elige un análisis (marcado [análisis]) para ver sus fuentes.',
  onlyAnalysisDeletable: 'Solo se pueden borrar análisis; las historias viven en Jira.',
  // Cortos: un aviso largo se parte en dos líneas en una terminal angosta
  analysisHasNoTasks: 'r es para historias; en un análisis usa t para sus puntos.',
  reviewNotYet: 'Aún no hay plan: pulsa Enter para refinar esta historia.',
  tasksNotYet: 'Las tareas aún no están en Jira: créalas con r y luego c.',
  selectedMarker: '>',
  blockLabel: 'bloque',
  analysisMarker: '[análisis]',
  // Valor de StorySummary.block cuando no hay bloque en curso
  noBlock: '—',
  onlyAnalysisLinkable: 'Vincular a Jira es solo de análisis; elige uno.',
  linkedTo: (epicKey: string) => `→ ${epicKey}`,
  needsProjectForAnalysis: 'Primero elige un proyecto con p; el análisis queda en el proyecto actual.',
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
  // Solo en el chat de un análisis: pide a Claude escribir los 3 documentos
  closeAnalysis: 'g',
  // Abre el navegador de la base para referenciar notas
  referenceNotes: 'b',
} as const;

export const CHAT_VISIBLE_MIN_ROWS = 6;
// Alto que ocupan marco, encabezado, actividad, entrada y pie alrededor de la conversación
export const CHAT_CHROME_ROWS = 17;
export const CHAT_DEFAULT_TERMINAL_ROWS = 30;
export const CHAT_DEFAULT_TERMINAL_COLUMNS = 80;
export const CHAT_HORIZONTAL_MARGIN = 8;
export const MESSAGE_INDENT = 2;
export const CONTEXT_K = 1000;
export const CURSOR = '▌';
// Filas máximas del campo de escritura (al pegar bloques grandes) y ancho con que se pintan las tabulaciones
export const CHAT_INPUT_MAX_ROWS = 5;
export const TAB_WIDTH = 4;
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
  inputClipped: (hidden: number) => `(+${hidden} líneas arriba)`,
  thinking: 'Claude está pensando...',
  scrolledHint: 'Estás viendo mensajes anteriores. PgDn para volver al final.',
  headerBlock: 'bloque',
  context: (tokens: number) => `contexto ${tokens >= CONTEXT_K ? `${Math.round(tokens / CONTEXT_K)}k` : tokens}`,
  cost: (usd: number) => `$${usd.toFixed(2)}`,
  tooLongHint: `La conversación ya es larga. Pulsa Ctrl+${CHAT_KEYS.newSession.toUpperCase()} para seguir en una sesión nueva desde la bitácora (gasta menos).`,
  closeAnalysisMessage:
    'Cerremos el análisis: escribe ahora los 3 documentos (análisis_propuesta.md, observaciones_funcional_tecnico.md y resumen_observaciones.md) en la carpeta del análisis y escribe fase.json con phase documented.',
  notesSent: (count: number) => `Referencié ${count === 1 ? '1 nota' : `${count} notas`} de la base: Claude las lee.`,
  closeBusy: 'Espera a que Claude termine para cerrar el análisis.',
  notesAlready: 'Esas notas ya estaban referenciadas.',
  notesNoKnowledge: `No hay base de conocimiento conectada: conéctala con ${KEYS.knowledgeBase} desde el inicio para referenciar notas.`,
  notesError: (message: string) => `No pude referenciar las notas: ${message}`,
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
  home: `↑↓ elegir · Enter continuar · ${KEYS.newStory} buscar en Jira · ${KEYS.changeProject} cambiar proyecto · ${KEYS.review} revisar plan · ${KEYS.closeStory} cerrar historia · ${KEYS.tasks} tareas o puntos del análisis · ${KEYS.myDay} mi día · ${KEYS.knowledgeBase} base de conocimiento · ${KEYS.calibration} calibración · ${KEYS.management} gestión · ${KEYS.newAnalysis} nuevo análisis · ${KEYS.detail} fuentes del análisis · ${KEYS.linkAnalysis} vincular análisis a Jira · ${KEYS.closeStory} o Supr borrar análisis · ${KEYS.quit} salir`,
  picker: `↑↓ elegir · Enter abrir · escribe para filtrar · ${KEYS.manualKeyAlt} o ${KEYS.manualKey} clave a mano · ${KEYS.changeProject} proyecto · Esc volver`,
  filtering: '↑↓ elegir · Enter abrir · Backspace borrar · Esc limpiar filtro',
  projects: '↑↓ elegir · Enter cambiar · escribe para filtrar · Esc volver',
  status: 'Esc volver',
  review: `↑↓ moverte · espacio marcar · ${KEYS.edit} editar · ${KEYS.useAdjusted} usar ajustado · ${KEYS.detail} detalle · ${KEYS.attachments} adjuntos · ${KEYS.create} crear en Jira · Esc inicio`,
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
  knowledgeSettings: '1-4 elegir · Esc inicio',
  management: 'Esc salir sin guardar',
  managementCheck: 'Esc cancelar',
  knowledgeBrowse: `↑↓ elegir · Enter abrir carpeta o nota · Backspace subir · ${KEYS.selectFolder} elegir esta carpeta · Esc cancelar`,
  reviewReadOnly: `↑↓ moverte · ${KEYS.detail} detalle · Esc volver`,
  tasks: `↑↓ moverte · espacio marcar · ${KEYS.start} iniciar · ${KEYS.finishDirect} finalizar · ${KEYS.giveBack} devolver · ${KEYS.removeTasks} borrar · ${KEYS.pendingFilter} pendientes · ${KEYS.retry} actualizar · ${KEYS.open} abrir · ${KEYS.viewPlan} ver plan · Esc inicio`,
  calibration: `${KEYS.retry} actualizar · Esc inicio`,
  points: `↑↓ moverte · ${KEYS.start} iniciar con Claude · ${KEYS.finishDirect} finalizar · ${KEYS.giveBack} devolver a pendiente · ${KEYS.retry} actualizar · Esc inicio`,
  linkEpic: `Enter conservar · ${KEYS.edit} cambiar la épica · Esc inicio`,
  linkPicker: `↑↓ elegir · Enter elegir · escribe para filtrar · ${KEYS.manualKeyAlt} o ${KEYS.manualKey} clave a mano · Esc volver o saltar`,
  linkPoints: `↑↓ moverte · espacio marcar · ${KEYS.edit} destino de lo marcado · ${KEYS.create} crear en Jira · Esc inicio`,
  linkDone: 'Esc inicio',
  myDay: `↑↓ moverte · ${KEYS.start} iniciar · ${KEYS.finishDirect} finalizar ·${KEYS.retry} actualizar · ${KEYS.open} abrir · Esc inicio`,
  options: '↑↓ elegir · Enter confirmar · Esc cancelar',
  yesNo: `${KEYS.confirmYes}/${KEYS.confirmNo}`,
  typeConfirm: 'Escribe la palabra y pulsa Enter · Esc cancelar',
  chat: `Enter enviar · PgUp/PgDn o ↑↓ leer · Ctrl+${CHAT_KEYS.newline.toUpperCase()} línea · Ctrl+${CHAT_KEYS.deepModel.toUpperCase()} Opus · Ctrl+${CHAT_KEYS.referenceNotes.toUpperCase()} notas de la base · Ctrl+${CHAT_KEYS.fullClaude.toUpperCase()} Claude completo (vuelves con /exit) · Esc inicio`,
  analysisChat: `Enter enviar · PgUp/PgDn o ↑↓ leer · Ctrl+${CHAT_KEYS.newline.toUpperCase()} línea · Ctrl+${CHAT_KEYS.deepModel.toUpperCase()} Opus · Ctrl+${CHAT_KEYS.referenceNotes.toUpperCase()} notas de la base · Ctrl+${CHAT_KEYS.closeAnalysis.toUpperCase()} cerrar y documentar · Esc inicio`,
} as const;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_MINUTE = 60;
export const FRAME_HORIZONTAL_OVERHEAD = 4;
export const FRAME_BOTTOM_MARGIN = 1;
export const REVIEW_CHROME_ROWS = 15;
export const REVIEW_MIN_VISIBLE_ROWS = 3;
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
  createdCount: (count: number) => `${count} ya creada(s) en Jira (t para verlas)`,
  allCreated: 'Todo el plan ya está en Jira; usa t para ver las tareas.',
  total: (count: number, estimate: string, expected: string, deviation: string) =>
    `Total (${count} marcada(s)): a Jira ${estimate} · esperado PERT ${expected} · σ ${deviation}`,
  jiraEstimate: (estimate: string, own: boolean) => `Jira ${estimate}${own ? ' (tuya)' : ''}`,
  dueDate: (date: string, manual: boolean) => `vence ${date} ${manual ? '(manual)' : '(rec.)'}`,
  overload: (date: string, total: string, capacity: string) =>
    `Aviso: el ${date} suma ${total} (más de ${capacity} por día). Puedes dejarlo así.`,
  reference: (recommended: string, date: string | null) =>
    `Recomendado: ${recommended}${date ? ` · fecha recomendada ${date}` : ''}`,
  adjusted: (adjusted: string) => `Ajustado según tu historial: ${adjusted} (${KEYS.useAdjusted} en la lista lo usa)`,
  history: (factor: string, count: number) => `Tu historial: real ≈ ${factor} × estimado (${count} medida(s))`,
  saveError: (message: string) => `No pude guardar el cambio: ${message}`,
  noneIncluded: 'Marca al menos una tarea para crearla en Jira.',
  nextStep: `Siguiente paso: marca lo que quieres crear y pulsa ${KEYS.create}.`,
  editTitle: (id: string) => `Editar ${id}`,
  emptySummary: 'El título no puede quedar vacío.',
  fields: {
    summary: 'Título',
    optimistic: 'Optimista (O)',
    likely: 'Probable (M)',
    pessimistic: 'Pesimista (P)',
    finalEstimate: 'Tu estimación (ej. 3h; vacío = recomendada)',
    dueDate: 'Fecha (AAAA-MM-DD, hoy, mañana, +2; vacío = recomendada)',
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
  tasks: (count: number, estimate: string) => `${count} tarea(s) · estimado total ${estimate}`,
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
  existingNote: '(ya estaba)',
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
  rootConfirm: `Usarás toda la bóveda como base: Claude la lee entera y solo escribe en la carpeta de notas de jm. ¿Confirmas? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  notesTitle: (dir: string) => `Notas de la base · ${dir || '/'}`,
  notesMarker: (marked: boolean) => (marked ? '[x]' : '[ ]'),
  notesCount: (count: number) => `Marcadas: ${count}`,
  notesNextStep: `Siguiente paso: entra a las carpetas, marca notas con espacio y pulsa ${KEYS.selectFolder} para referenciarlas. Enter abre carpetas o vista previa; Esc cancela.`,
  notesNoneMarked: 'Marca al menos una nota con espacio antes de confirmar.',
  browseNextStep: `Siguiente paso: entra a la carpeta donde continuar y pulsa ${KEYS.selectFolder} para elegirla.`,
} as const;

const pluralStories = (count: number) =>
  count === 1
    ? 'Queda 1 historia en la ubicación anterior; sigue ahí.'
    : `Quedan ${count} historias en la ubicación anterior; siguen ahí.`;

export const KNOWLEDGE_SETTINGS_TEXTS = {
  title: 'Base de conocimiento de esta carpeta',
  needsProject: 'Primero elige un proyecto con p; la base de conocimiento se configura por proyecto.',
  loading: 'Leyendo la configuración de la base...',
  noBase: 'Sin base de conocimiento: las historias viven en .jm de esta carpeta.',
  type: (type: 'mcp' | 'local') => `Tipo: ${type === 'mcp' ? 'MCP' : 'carpeta local'}`,
  target: (type: 'mcp' | 'local', target: string) => `${type === 'mcp' ? 'URL' : 'Carpeta'}: ${target}`,
  base: (baseFolder: string) => `Carpeta base: ${baseFolder || '/'}`,
  adr: (folder: string) => `Carpeta de notas (JM-ADR): ${folder}/`,
  adrUnknown: 'Carpeta de notas (JM-ADR): no se pudo leer',
  connectionOk: 'Conexión: responde',
  connectionError: (message: string) => `Conexión: no responde (${message})`,
  actions: {
    base: '1  Cambiar la carpeta base',
    connection: '2  Cambiar la conexión',
    remove: '3  Quitar la base de conocimiento',
    renew: '4  Renovar la API key',
  },
  // Sin base es la única acción; conserva la tecla 2 de «Cambiar la conexión»
  connectAction: '2  Conectar una base',
  nextStep: 'Siguiente paso: pulsa el número de lo que quieres hacer o Esc para volver.',
  loadError: (message: string) => `No pude leer la configuración: ${message}`,
  leftBehind: pluralStories,
  movesOnOpen: (count: number) =>
    count === 1
      ? 'Hay 1 historia en .jm de este proyecto; pasará a la base cuando la abras.'
      : `Hay ${count} historias en .jm de este proyecto; pasarán a la base cuando las abras.`,
  changed: 'Listo, la nueva configuración ya está en uso.',
  removed: 'Listo, esta carpeta quedó sin base de conocimiento.',
  removeQuestion: `¿Quitas la base de conocimiento de esta carpeta? Las historias no se borran. (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  removeNextStep: `Pulsa ${KEYS.confirmYes} para quitarla; cualquier otra tecla cancela.`,
  renewNeedsMcp: 'Renovar la API key solo aplica a una base MCP.',
  renewLabel: 'Nueva API key: ',
  renewNextStep: 'Pega la nueva API key y pulsa Enter. Se verifica con el servidor y se guarda cifrada con tu PIN.',
  renewing: 'Verificando la nueva API key...',
  renewed: 'API key renovada. La conexión y la carpeta base siguen igual.',
  renewError: (message: string) => `No pude renovar la API key: ${message}`,
} as const;

export const TASKS_TEXTS = {
  title: (key: string, summary: string) => `Tareas · ${key} ${summary}`,
  loading: 'Leyendo las subtareas en Jira...',
  empty: 'La historia no tiene subtareas en Jira.',
  notInPlan: 'no es del plan',
  missing: 'no encontrada en Jira',
  pendingDone: 'cierre por reintentar',
  noAssignee: 'sin asignar',
  noEstimate: '—',
  noDate: '—',
  summary: (done: number, total: number, pending: string) => `${done} de ${total} finalizadas · ${pending} pendientes`,
  real: (claude: string, elapsed: string) => `real ${claude} / ${elapsed}`,
  noReal: '—',
  measured: (count: number, estimate: string, claude: string, elapsed: string) =>
    `Medidas ${count}: estimado ${estimate} · con Claude ${claude} · de inicio a fin ${elapsed}`,
  realLegend: 'real = con Claude abierto / de inicio a fin',
  filterOn: 'Filtro: solo pendientes',
  nextStep: `Siguiente paso: elige una tarea y pulsa ${KEYS.start} para iniciarla.`,
  doneBlocked: (key: string) => `${key} está finalizada: no se puede borrar ni editar.`,
  inProgressBlocked: (key: string) => `${key} está en curso: devuélvela con ${KEYS.giveBack} antes de borrarla.`,
  nothingSelected: 'Marca con espacio las tareas que quieres borrar.',
  starting: (key: string) => `Iniciando ${key} en Jira...`,
  reopenQuestion: (key: string) =>
    `${key} ya está finalizada. ¿La reabro y la inicio? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  chooseTransition: "Tu proyecto no tiene un estado 'En curso' conocido. ¿Cuál usas para empezar? (lo recordaré)",
  chooseReturn: (key: string) => `¿A qué estado devuelves ${key}?`,
  returned: (key: string, name: string) => `${key} devuelta con «${name}». Ya puedes borrarla.`,
  actionError: (message: string) => `No pude completar la acción: ${message}`,
  deleteTitle: 'Se borrarán de Jira estas subtareas:',
  deleteLine: (key: string, title: string, status: string, assignee: string) =>
    `  ${key} · ${title} · ${status} · ${assignee}`,
  deletePrompt: `Escribe ${DELETE_CONFIRM_WORD} para confirmar: `,
  deleteMismatch: `Eso no es «${DELETE_CONFIRM_WORD}»: no borré nada.`,
  deleting: 'Borrando en Jira...',
  deleteDone: (ok: number, failed: number) => `Borradas ${ok}; con problemas ${failed}.`,
  deleteFailLine: (key: string, message: string) => `  ${key}: ${message}`,
  retryDone: (finished: number, failed: number) =>
    `Cierres reintentados: ${finished} listos, ${failed} siguen pendientes.`,
  openError: (message: string) => `No pude abrir el navegador: ${message}`,
  planTitle: 'Plan (solo lectura)',
} as const;

export const POINTS_TEXTS = {
  loading: 'Leyendo los puntos del análisis...',
  title: (id: string, name: string) => `Puntos del análisis ${id} · ${name}`,
  empty: 'Este análisis aún no tiene puntos: ábrelo con Enter y debate con Claude.',
  invalid: (message: string) => `Los puntos del análisis no son válidos: ${message}`,
  noneInScope: 'Todos los puntos quedaron fuera de alcance: no hay nada que iniciar.',
  status: { pending: 'pendiente', started: 'en curso', done: 'finalizada' },
  line: (id: string, status: string, title: string, estimate: string, real: string, issueKey: string | null = null) =>
    `${id} · ${status} · ${title} · esperado ${estimate} · real ${real}${issueKey ? ` · ${issueKey}` : ''}`,
  noEstimate: '—',
  jiraNotMoved: (id: string) => `${id} cambió en jm; su tarea en Jira no se movió.`,
  chooseReturn: (key: string) => `¿A qué estado devuelvo ${key} en Jira?`,
  noReal: '—',
  real: (claude: string, elapsed: string) => `${claude} / ${elapsed}`,
  summary: (done: number, total: number) => `${done} de ${total} puntos finalizados`,
  nextStep: `Siguiente paso: elige un punto y pulsa ${KEYS.start} para trabajarlo con Claude.`,
  reopenQuestion: (id: string) => `${id} ya está finalizado. ¿Lo reabro y lo inicio? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  finishQuestion: (id: string) => `¿Terminaste ${id}? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  working: 'Guardando...',
  finished: (id: string) => `${id} quedó finalizado.`,
  keptInProgress: (id: string) => `${id} sigue en curso.`,
  alreadyDone: (id: string) => `${id} ya está finalizado.`,
  notStarted: (id: string) => `${id} no está en curso: no hay nada que devolver.`,
  returned: (id: string) => `${id} volvió a pendiente; su tiempo acumulado se conserva.`,
  actionError: (message: string) => `No pude completar la acción: ${message}`,
} as const;

export const LINK_TEXTS = {
  loading: 'Leyendo el análisis...',
  noPoints: 'No hay puntos en alcance que vincular: debate el análisis con Claude.',
  epicCurrent: (key: string) => `Épica del análisis: ${key}`,
  epicTitle: 'Épica del análisis (Esc para saltar)',
  epicEmpty: `No encontré épicas: usa ${KEYS.manualKey} para escribir la clave.`,
  epicNextStep: 'Siguiente paso: elige la épica y pulsa Enter, o Esc para saltar.',
  checking: (key: string) => `Revisando ${key} en Jira...`,
  epicSaved: (key: string) => `Épica ${key} vinculada.`,
  targetTitle: 'Destino de los puntos marcados',
  targetEmpty: `Sin épica no hay lista: usa ${KEYS.manualKey} para escribir una clave.`,
  targetNextStep: 'Siguiente paso: elige la épica o una historia.',
  epicOption: (key: string) => `${key} · épica (tareas)`,
  targetSet: (count: number, key: string) => `${count} punto(s) → ${key}.`,
  nothingMarked: 'Marca puntos con espacio antes de elegir destino.',
  fixed: 'ya creado: no cambia de destino',
  noTarget: 'sin destino',
  line: (id: string, title: string, estimate: string, status: string, target: string) =>
    `${id} · ${title} · ${estimate} · ${status} · ${target}`,
  nothingToCreate: 'Ningún punto tiene destino: elige uno con e (o la épica).',
  confirmTitle: 'Voy a crear en Jira:',
  group: (ids: string, key: string, childKind: 'standard' | 'subtask') =>
    `${ids} → ${key} (${childKind === 'subtask' ? 'subtareas' : 'tareas'})`,
  skipped: (ids: string) => `Sin destino, se omiten: ${ids}`,
  confirm: `¿Creo estas tareas? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  creating: 'Creando en Jira... no cierres la consola.',
  resultTitle: 'Resultado',
  created: (id: string, key: string) => `${id} → ${key} creada`,
  createdNote: (id: string, key: string, note: string) => `${id} → ${key} creada · ${note}`,
  failed: (id: string, message: string) => `${id} sin crear: ${message}`,
  summary: (created: number, failed: number) => `${created} creada(s), ${failed} con error.`,
  actionError: (message: string) => `No pude vincular: ${message}`,
  refused: (message: string) => `Ese destino no sirve: ${message}`,
} as const;

export const PLANNING_TEXTS = {
  checking: 'Revisando si ya hay una Planificación abierta...',
  suggesting: 'Calculando la estimación sugerida...',
  question: (key: string, managementKey: string | null = null) =>
    `¿Registro una tarea de Planificación en ${managementKey ? `${managementKey} (gestión)` : key}? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  why: 'El análisis también es trabajo: queda en Jira bajo la historia y se mide su tiempo de inicio a fin.',
  whyManagement: (managementKey: string, storyKey: string) =>
    `El análisis también es trabajo: queda en Jira bajo ${managementKey} (gestión), con ${storyKey} en el título, y se mide su tiempo de inicio a fin.`,
  stillOpen: (key: string) => `Sigues en la Planificación ${key}; al salir del chat te pregunto si terminaste.`,
  formTitle: (key: string) => `Planificación de ${key}`,
  fields: {
    estimate: 'Estimación (ej. 1h, 45m)',
    dueDate: 'Fecha (AAAA-MM-DD, hoy, mañana, +2)',
  },
  suggested: (measured: number) =>
    measured > 0
      ? `Sugerida con lo que te tomaron ${measured} Planificación(es) anteriores.`
      : 'Sugerida: aún no hay Planificaciones medidas.',
  creating: 'Creando la Planificación en Jira...',
  created: (key: string) => `${key} creada y En curso. Al salir del chat te pregunto si terminaste.`,
  createdNotStarted: (key: string) =>
    `${key} creada, pero no pude pasarla a En curso en Jira; su tiempo ya corre en jm.`,
  continueHint: 'Enter o Esc seguir al chat',
  formHint: '↑↓ o Tab cambiar de campo · Enter siguiente o crear · Esc no registrar',
} as const;

const MANAGEMENT_PROBLEM_REASONS = {
  done: 'está finalizada',
  'not-found': 'ya no existe en Jira',
  subtask: 'es una subtarea',
} as const;

export const ANALYSIS_TEXTS = {
  newTitle: 'Nuevo análisis',
  fields: {
    name: 'Nombre',
    paths: 'Archivos (rutas completas separadas por coma o ;)',
    text: 'Texto pegado (opcional)',
  },
  nameRequired: 'El análisis necesita un nombre.',
  formHint: '↑↓ o Tab cambiar de campo · Enter siguiente o guardar · Esc cancelar',
  sourcesHint: 'Tipos admitidos: .md .txt .pdf .eml .png .jpg · hasta 20 MB por archivo.',
  saving: 'Guardando las fuentes...',
  created: (id: string, name: string) => `Análisis ${id} creado: ${name}`,
  added: 'Fuentes agregadas',
  resultOk: (source: string, file: string) => `  listo: ${source} -> fuentes/${file}`,
  resultFailed: (source: string, message: string) => `  no se copió: ${source}: ${message}`,
  noSources: 'Sin fuentes por ahora: puedes agregarlas al entrar al análisis.',
  resultsHint: 'Enter continuar',
  loading: 'Leyendo el análisis...',
  title: (id: string, name: string) => `Análisis ${id} · ${name}`,
  sourcesTitle: (count: number) => `Fuentes (${count}):`,
  noSourcesYet: `Aún no hay fuentes. Pulsa ${KEYS.addSources} para agregarlas.`,
  sourceLine: (file: string, pasted: boolean) => `  ${file}${pasted ? ' (texto pegado)' : ''}`,
  trackingTitle: 'Tarea de análisis:',
  noTracking: 'Sin tarea de análisis registrada.',
  trackingLine: (key: string, status: string) => `  ${key} · ${status}`,
  trackingStatus: { started: 'En curso', done: 'Finalizada' },
  nextStep: `Siguiente paso: ${KEYS.addSources} para agregar fuentes; el debate con Claude se abre con Enter desde el inicio.`,
  detailHint: `${KEYS.addSources} agregar fuentes · Esc inicio`,
  addTitle: 'Agregar fuentes',
  remove: {
    loading: 'Leyendo el análisis...',
    title: (id: string, name: string) => `Borrar el análisis ${id} · ${name}`,
    sources: (count: number) => `Fuentes que se borran: ${count}`,
    documents: (documented: boolean) =>
      documented ? 'Tiene documentos generados: se borran también.' : 'Aún no tiene documentos.',
    scope: 'Se borra todo: estado, conversación y copias. Las notas de la base que consultó no se tocan.',
    prompt: `Escribe ${DELETE_CONFIRM_WORD} para confirmar: `,
    mismatch: `Eso no es «${DELETE_CONFIRM_WORD}»: no borré nada.`,
    done: (id: string) => `Análisis ${id} borrado.`,
    deleting: 'Borrando el análisis...',
  },
  tracking: {
    question: (name: string, managementKey: string | null) =>
      `¿Registro una tarea de análisis para "${name}"${managementKey ? ` en ${managementKey} (gestión)` : ''}? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
    why: 'El análisis también es trabajo: queda en Jira y se mide su tiempo de inicio a fin.',
    whyManagement: (managementKey: string) =>
      `El análisis también es trabajo: queda en Jira bajo ${managementKey} (gestión) y se mide su tiempo de inicio a fin.`,
    formTitle: (name: string) => `Tarea de análisis de "${name}"`,
    continueHint: 'Enter o Esc seguir al análisis',
    stillOpen: (key: string) => `Sigues en la tarea de análisis ${key}; al salir te pregunto si terminaste.`,
    created: (key: string) => `${key} creada y En curso. Al salir del análisis te pregunto si terminaste.`,
    createdNotStarted: (key: string) =>
      `${key} creada, pero no pude pasarla a En curso en Jira; su tiempo ya corre en jm.`,
    whereTitle: '¿Dónde registro la tarea de análisis?',
    whereEmpty: `No encontré épicas en el proyecto. Pulsa ${KEYS.manualKey} para escribir la clave de una historia o épica.`,
    whereNextStep: `Siguiente paso: elige una épica y pulsa Enter, o ${KEYS.manualKey} para escribir la clave de una historia o épica.`,
    whereHint: `↑↓ elegir · Enter elegir · escribe para filtrar · ${KEYS.manualKeyAlt} o ${KEYS.manualKey} clave a mano · Esc no registrar`,
    whereProblem: (message: string) => `No pude usar ese destino: ${message}`,
  },
} as const;

export const MANAGEMENT_TEXTS = {
  title: 'Gestión del tablero',
  needsProject: 'Primero elige un proyecto con p; la gestión se configura por proyecto.',
  loading: 'Leyendo la gestión de este proyecto...',
  question: '¿Tienes una épica o historia para reuniones, análisis y coordinaciones?',
  why: `Ahí quedan registradas las tareas de análisis y planificación. Se guarda por proyecto y se cambia con ${KEYS.management} desde el inicio.`,
  current: (status: ManagementStatus) =>
    status === 'unset'
      ? null
      : status === 'none'
        ? 'Ahora: sin gestión (no vuelvo a preguntar).'
        : `Ahora: ${status.key} · ${status.summary}`,
  pickTitle: (projectKey: string) => `Épica de gestión de ${projectKey}`,
  noEpics: `No encontré épicas en el proyecto. Pulsa ${KEYS.manualKey} para escribir la clave de una historia o épica.`,
  pickNextStep: `Siguiente paso: elige una épica y pulsa Enter, o ${KEYS.manualKey} para escribir la clave de una historia o épica.`,
  pickHint: `↑↓ elegir · Enter guardar · escribe para filtrar · ${KEYS.manualKeyAlt} o ${KEYS.manualKey} clave a mano · Esc volver`,
  saving: 'Comprobando en Jira y guardando...',
  saveError: (message: string) => `No pude guardar la gestión: ${message}`,
  askHint: `${KEYS.confirmYes} elegir · ${KEYS.confirmNo} no tengo (no vuelvo a preguntar) · Esc seguir sin guardar`,
  fallback: (key: string, reason: ManagementProblem, message: string) =>
    `La de gestión ${key} ya no sirve (${reason === 'error' ? message : MANAGEMENT_PROBLEM_REASONS[reason]}); la Planificación quedó en la historia. Cámbiala con ${KEYS.management}.`,
} as const;

export const FINISH_TEXTS = {
  question: (key: string) => `¿Terminaste ${key}? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  working: 'Pasando la tarea a Finalizada...',
  done: (key: string) => `${key} quedó Finalizada. La estimación original no se tocó.`,
  keptInProgress: (key: string) => `${key} sigue En curso.`,
  chooseTransition: "Tu proyecto no tiene un estado 'Finalizada' conocido. ¿Cuál usas para terminar? (lo recordaré)",
  failed: (message: string) => `No pude finalizarla: ${message}`,
  directTitle: 'Se finalizarán en Jira estas tareas, sin iniciarlas ni abrir Claude:',
  directLine: (key: string, title: string, status: string) => `  ${key} · ${title} · ${status}`,
  directQuestion: `¿Finalizar sin abrir Claude? (${KEYS.confirmYes}/${KEYS.confirmNo})`,
  directWorking: (key: string) => `Finalizando ${key} en Jira...`,
  directSkipped: (keys: string[]) => `Ya finalizadas, se omiten: ${keys.join(', ')}.`,
  directNothing: 'No hay tareas por finalizar: las elegidas ya están finalizadas.',
  directCancelled: 'sin elegir transición',
  directSummary: (done: number, failed: string[]) =>
    failed.length === 0
      ? `${done} finalizadas.`
      : `${done} finalizadas, ${failed.length} con error: ${failed.join('; ')}`,
} as const;

export const CALIBRATION_TEXTS = {
  title: 'Calibración · estimado vs. real',
  loading: 'Leyendo las tareas medidas de esta carpeta...',
  empty: `Aún no hay tareas medidas. Inicia una con ${KEYS.start} en tareas y finalízala para empezar a comparar.`,
  totals: (count: number, estimate: string, claude: string, elapsed: string) =>
    `${count} tarea(s) medidas · estimado ${estimate} · con Claude ${claude} · de inicio a fin ${elapsed}`,
  claudeRatio: (ratio: string) => `Con Claude abierto: real = ${ratio} × estimado`,
  elapsedRatio: (ratio: string) => `De inicio a fin: real = ${ratio} × estimado`,
  noRatio: '—',
  byRiskTitle: 'Por riesgo:',
  riskLine: (risk: string, count: number, claude: string, elapsed: string) =>
    `  ${risk} · ${count} · con Claude ${claude}× · de inicio a fin ${elapsed}×`,
  outliersTitle: 'Las más desviadas (con Claude vs. estimado):',
  outlierLine: (key: string, title: string, estimate: string, claude: string, elapsed: string) =>
    `  ${key} · ${title} · estimado ${estimate} · con Claude ${claude} · de inicio a fin ${elapsed}`,
  excludedDirect: (count: number) =>
    `${count} finalizada(s) con ${KEYS.finishDirect} quedan fuera: no tienen inicio medido.`,
  unreadable: (count: number) => `${count} historia(s) no se pudieron leer (¿base sin conexión?).`,
  planning: (count: number, estimate: string, elapsed: string) =>
    `Planificaciones y análisis (aparte): ${count} medida(s) · estimado ${estimate} · de inicio a fin ${elapsed}`,
  analysisPoints: (count: number, estimate: string, elapsed: string) =>
    `Puntos de análisis (aparte): ${count} medido(s) · esperado ${estimate} · de inicio a fin ${elapsed}`,
  note: 'Abierto no siempre es trabajando: úsalo como referencia, no como cronómetro.',
} as const;

export const MY_DAY_TEXTS = {
  title: 'Mi día',
  loading: 'Buscando tus tareas de hoy en Jira...',
  empty: 'No tienes tareas que venzan hoy ni vencidas.',
  noParent: 'sin historia',
  total: (hours: string, capacity: string) => `Total: ${hours} de ${capacity}`,
  overdue: 'vencida',
  nextStep: `Siguiente paso: elige una tarea y pulsa ${KEYS.start} para iniciarla.`,
} as const;
