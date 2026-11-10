import type {
  AnalysisBridge,
  AnalysisDetail,
  NewAnalysisInput,
  LinkPointResult,
  LinkTargetOutcome,
  PointRow,
  PointsModel,
  PointStartOutcome,
  SourceResult,
  SourcesInput,
} from '../refinement/analysis-types.js';
import type {
  ChatBridge,
  ChatHeader,
  ChatLine,
  ChatUiEvent,
  KnowledgeChangeResult,
  KnowledgeChoice,
  KnowledgeListing,
  KnowledgeSettings,
  KnowledgeStatus,
  KnowledgeSummary,
  KnowledgeTarget,
  ServerInspection,
} from '../refinement/chat-types.js';
import type { ManagementBridge, ManagementStatus } from '../refinement/management-types.js';
import type {
  AssigneeView,
  CloseResult,
  ClosePreview,
  CreateOutcome,
  CreatePreview,
  CreateProgress,
  CreateRequest,
  CreationTarget,
  ExistingMatch,
  EstimatePreview,
  PlanBridge,
  ReviewFile,
  ReviewModel,
  ReviewTask,
  TargetResult,
  TaskPatch,
} from '../refinement/review-types.js';
import type {
  CalibrationModel,
  DeleteResult,
  MyDayModel,
  PlanningInput,
  PlanningOutcome,
  TaskRow,
  TasksBridge,
  TransitionOptions,
  TransitionOutcome,
} from '../refinement/tasks-types.js';
import type { TaskEstimate } from '../refinement/types.js';

const WAIT_TIMEOUT_MS = 2000;
const WAIT_POLL_MS = 15;

// Espera a que se cumpla una condición (el render y los puentes falsos son asíncronos)
export async function waitFor(
  condition: () => boolean,
  what = 'la condición',
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Se agotó el tiempo esperando ${what}`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

export const FAKE_CODE_FOLDER = 'C:\\repo\\jm';

export const BASE_HEADER: ChatHeader = {
  key: 'AQ-45',
  phase: 'debate',
  phaseLabel: 'debate',
  blockLabel: 'riesgos',
  model: 'sonnet',
  contextTokens: 42_300,
  costUsd: 0.05,
  tooLong: false,
};

// Puente de chat falso para las pruebas de la app: no lanza claude
const FAKE_KB_URL = 'https://127.0.0.1:27124/mcp';
const FAKE_KB_BASE = 'PROYECTOS/X';

export const FAKE_SETTINGS: KnowledgeSettings = {
  type: 'mcp',
  target: FAKE_KB_URL,
  baseFolder: FAKE_KB_BASE,
  adrFolder: '06-JM-ADR',
  connection: 'ok',
  connectionError: null,
};

export interface FakeKnowledge {
  status?: KnowledgeStatus;
  statusError?: boolean;
  // Simula la lectura lenta del estado de la base: la app queda un rato en 'routing'
  statusDelayMs?: number;
  inspection?: ServerInspection;
  // Carpetas de la base falsa: ruta -> listado
  listings?: Record<string, KnowledgeListing>;
  previews?: Record<string, string>;
  openError?: string;
  summary?: KnowledgeSummary;
  settings?: KnowledgeSettings;
  changeResult?: KnowledgeChangeResult;
  // Errores simulados al cambiar la base o renovar la key
  changeError?: string;
  renewError?: string;
  // Cuántas notas toma como nuevas referenceNotes; por defecto todas
  notesAdded?: number;
}

export function createFakeChat(
  header: Partial<ChatHeader> = {},
  history: ChatLine[] = [],
  knowledge: FakeKnowledge = {},
) {
  const sent: string[] = [];
  const calls = {
    opened: [] as string[],
    toggle: 0,
    newSession: 0,
    close: 0,
    saved: [] as KnowledgeChoice[],
    trusted: 0,
    inspected: [] as string[],
    listed: [] as Array<{ connection: KnowledgeTarget; dir: string }>,
    changed: [] as KnowledgeChoice[],
    renewed: [] as string[],
    notes: [] as string[][],
  };
  let listener: ((event: ChatUiEvent) => void) | null = null;
  const chat: ChatBridge = {
    open: async (key, onEvent) => {
      if (knowledge.openError) throw new Error(knowledge.openError);
      listener = onEvent;
      calls.opened.push(key);
      return {
        header: { ...BASE_HEADER, ...header, key },
        codeFolder: FAKE_CODE_FOLDER,
        history,
        idle: history.length > 0,
      };
    },
    send: (text) => void sent.push(text),
    toggleDeep: () => void (calls.toggle += 1),
    newSession: () => void (calls.newSession += 1),
    close: async () => void (calls.close += 1),
    referenceNotes: async (notes) => {
      calls.notes.push(notes);
      return knowledge.notesAdded ?? notes.length;
    },
    knowledgeStatus: async () => {
      if (knowledge.statusDelayMs) await new Promise((resolve) => setTimeout(resolve, knowledge.statusDelayMs));
      if (knowledge.statusError) throw new Error('estado ilegible');
      return knowledge.status ?? 'set';
    },
    inspectServer: async (url) => {
      calls.inspected.push(url);
      return knowledge.inspection ?? { tls: 'system' };
    },
    listKnowledge: async (connection, dir) => {
      calls.listed.push({ connection, dir });
      const listing = knowledge.listings?.[dir];
      if (!listing) throw new Error(`no existe ${dir}`);
      return listing;
    },
    previewKnowledge: async (_connection, file) => knowledge.previews?.[file] ?? '',
    saveKnowledge: async (choice) => void calls.saved.push(choice),
    describeKnowledge: async () => knowledge.summary ?? { type: 'mcp', target: FAKE_KB_URL, baseFolder: FAKE_KB_BASE },
    trustKnowledge: async () => void (calls.trusted += 1),
    knowledgeSettings: async () => knowledge.settings ?? FAKE_SETTINGS,
    changeKnowledge: async (choice) => {
      if (knowledge.changeError) throw new Error(knowledge.changeError);
      calls.changed.push(choice);
      return knowledge.changeResult ?? { leftBehind: 0 };
    },
    renewKnowledgeKey: async (apiKey) => {
      if (knowledge.renewError) throw new Error(knowledge.renewError);
      calls.renewed.push(apiKey);
    },
  };
  return { chat, sent, calls, header, emit: (event: ChatUiEvent) => listener?.(event) };
}

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const FAKE_TIME = /^(?:(\d+)h)?(?:(\d+)m)?$/;

function fakeSeconds(text: string): number {
  const match = FAKE_TIME.exec(text.trim());
  if (!match || (!match[1] && !match[2])) throw new Error(`Formato de tiempo inválido: "${text}".`);
  return Number(match[1] ?? 0) * SECONDS_PER_HOUR + Number(match[2] ?? 0) * SECONDS_PER_MINUTE;
}

function fakePreview(estimate: TaskEstimate): EstimatePreview {
  try {
    const o = fakeSeconds(estimate.optimistic);
    const m = fakeSeconds(estimate.likely);
    const p = fakeSeconds(estimate.pessimistic);
    if (!(o > 0 && o <= m && m <= p)) throw new Error('Debe cumplirse optimista <= probable <= pesimista.');
    return { ok: true, expectedSeconds: Math.round((o + 4 * m + p) / 6), stdDevSeconds: Math.round((p - o) / 6) };
  } catch (err: unknown) {
    return { ok: false, message: (err as Error).message };
  }
}

export const fakeTask = (id: string, patch: Partial<ReviewTask> = {}): ReviewTask => ({
  id,
  summary: `Tarea ${id}`,
  description: `Detalle de ${id}`,
  doneCriteria: ['Pasa el test'],
  estimate: { optimistic: '30m', likely: '1h', pessimistic: '2h' },
  risk: 'medium',
  rationale: 'Parecido a AQ-10',
  include: true,
  attachments: [],
  expectedSeconds: 3900,
  stdDevSeconds: 900,
  recommendedSeconds: 3900,
  effectiveSeconds: 3900,
  adjustedSeconds: null,
  adjustedEstimate: null,
  recommendedDate: '2026-11-05',
  effectiveDate: '2026-11-05',
  dateManual: false,
  jiraKey: null,
  ...patch,
});

const FAKE_CAPACITY_SECONDS = 8 * SECONDS_PER_HOUR;

function withTotals(model: ReviewModel): ReviewModel {
  const included = model.tasks.filter((t) => t.include && !t.jiraKey);
  return {
    ...model,
    createdCount: model.tasks.filter((t) => t.jiraKey).length,
    daySeconds: included.reduce<Record<string, number>>((days, t) => {
      if (t.effectiveDate) days[t.effectiveDate] = (days[t.effectiveDate] ?? 0) + t.effectiveSeconds;
      return days;
    }, {}),
    totals: {
      taskCount: included.length,
      expectedSeconds: included.reduce((sum, t) => sum + t.expectedSeconds, 0),
      effectiveSeconds: included.reduce((sum, t) => sum + t.effectiveSeconds, 0),
      stdDevSeconds: Math.round(Math.sqrt(included.reduce((sum, t) => sum + t.stdDevSeconds ** 2, 0))),
    },
  };
}

export interface FakePlanOptions {
  tasks?: ReviewTask[];
  files?: ReviewFile[];
  preview?: Partial<CreatePreview>;
  targets?: Record<string, TargetResult>;
  outcomes?: CreateOutcome[];
  progress?: CreateProgress[];
  closePreview?: ClosePreview;
  closeResult?: CloseResult;
  assignees?: AssigneeView[];
  existing?: Record<string, ExistingMatch[]>;
  history?: ReviewModel['history'];
}

export const FAKE_TARGET: CreationTarget = {
  parentKey: 'AQ-45',
  parentSummary: 'Login social',
  childKind: 'subtask',
  issueTypeId: '4',
  issueTypeName: 'Subtarea',
};
export const FAKE_ASSIGNEE: AssigneeView = { accountId: 'acc-1', displayName: 'Marcello Cano' };

// Puente de plan falso en memoria: aplica los cambios como el real, sin disco ni Jira
export function createFakePlan(options: FakePlanOptions = {}) {
  let model = withTotals({
    storyKey: 'AQ-45',
    summary: 'Login social',
    phase: 'plan',
    tasks: options.tasks ?? [
      fakeTask('T1'),
      fakeTask('T2', { expectedSeconds: 7200, stdDevSeconds: 1800, recommendedSeconds: 7200, effectiveSeconds: 7200 }),
    ],
    files: options.files ?? [],
    totals: { taskCount: 0, expectedSeconds: 0, effectiveSeconds: 0, stdDevSeconds: 0 },
    createdCount: 0,
    daySeconds: {},
    dailyCapacitySeconds: FAKE_CAPACITY_SECONDS,
    history: options.history ?? null,
  });
  const calls = {
    updates: [] as Array<{ taskId: string; patch: TaskPatch }>,
    purposes: [] as Array<{ file: string; purpose: string }>,
    toggles: [] as Array<{ file: string; taskId: string }>,
    created: [] as CreateRequest[],
    closed: [] as string[][],
    opened: [] as string[],
    openedFiles: [] as string[],
    prepareClose: 0,
    resolved: [] as string[],
  };
  let createCall = 0;
  const plan: PlanBridge = {
    load: async () => model,
    previewEstimate: fakePreview,
    updateTask: async (_key, taskId, patch) => {
      if (patch.estimate) {
        const preview = fakePreview(patch.estimate);
        if (!preview.ok) throw new Error(preview.message);
      }
      calls.updates.push({ taskId, patch });
      model = withTotals({
        ...model,
        phase: 'reviewed',
        tasks: model.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const next = { ...t, ...(patch.summary !== undefined ? { summary: patch.summary } : {}) };
          if (patch.include !== undefined) next.include = patch.include;
          if (patch.finalEstimate !== undefined) {
            const text = patch.finalEstimate?.trim() ?? '';
            next.finalEstimate = text || undefined;
            next.effectiveSeconds = text ? fakeSeconds(text) : next.recommendedSeconds;
          }
          if (patch.dueDate !== undefined) {
            const text = patch.dueDate?.trim() ?? '';
            next.dueDateManual = Boolean(text);
            next.dateManual = Boolean(text);
            next.effectiveDate = text || next.recommendedDate;
          }
          if (patch.estimate) {
            const preview = fakePreview(patch.estimate) as Extract<EstimatePreview, { ok: true }>;
            Object.assign(next, {
              estimate: patch.estimate,
              expectedSeconds: preview.expectedSeconds,
              stdDevSeconds: preview.stdDevSeconds,
            });
          }
          return next;
        }),
      });
      return model;
    },
    setAttachmentPurpose: async (_key, file, purpose) => {
      calls.purposes.push({ file, purpose });
      model = { ...model, files: model.files.map((f) => (f.file === file ? { ...f, purpose } : f)) };
      return model;
    },
    toggleAttachmentTask: async (_key, file, taskId) => {
      calls.toggles.push({ file, taskId });
      model = {
        ...model,
        files: model.files.map((f) =>
          f.file === file
            ? {
                ...f,
                taskIds: f.taskIds.includes(taskId) ? f.taskIds.filter((id) => id !== taskId) : [...f.taskIds, taskId],
              }
            : f,
        ),
      };
      return model;
    },
    openAttachment: async (_key, file) => void calls.openedFiles.push(file),
    prepareCreate: async () => ({
      taskCount: model.totals.taskCount,
      estimateSeconds: model.totals.effectiveSeconds,
      parent: { kind: 'ready', target: FAKE_TARGET },
      assignee: FAKE_ASSIGNEE,
      uploads: [],
      existing: [],
      ...options.preview,
    }),
    resolveTarget: async (parentKey) => {
      calls.resolved.push(parentKey);
      return options.targets?.[parentKey] ?? { ok: false, message: `No encontré ${parentKey} en Jira.` };
    },
    findExisting: async (_key, target) => options.existing?.[target.parentKey] ?? [],
    listAssignees: async () => options.assignees ?? [FAKE_ASSIGNEE, { accountId: 'acc-2', displayName: 'Ana Pérez' }],
    create: async (_key, request, onProgress) => {
      calls.created.push(request);
      for (const progress of options.progress ?? []) onProgress(progress);
      const outcomes = options.outcomes ?? [
        { ok: true, created: [], parentKey: request.target.parentKey, estimateSkipped: false },
      ];
      return outcomes[Math.min(createCall++, outcomes.length - 1)];
    },
    openInBrowser: async (issueKey) => void calls.opened.push(issueKey),
    prepareClose: async () => {
      calls.prepareClose += 1;
      return options.closePreview ?? { deletable: [], kept: [] };
    },
    close: async (_key, files) => {
      calls.closed.push(files);
      return options.closeResult ?? { deleted: files, kept: [] };
    },
  };
  return { plan, calls, getModel: () => model };
}

const EMPTY_GROUP = {
  count: 0,
  estimateSeconds: 0,
  claudeSeconds: 0,
  elapsedSeconds: 0,
  claudeRatio: null,
  elapsedRatio: null,
};

export const EMPTY_CALIBRATION: CalibrationModel = {
  total: EMPTY_GROUP,
  byRisk: [],
  outliers: [],
  excludedDirect: 0,
  unreadable: 0,
  planning: { count: 0, estimateSeconds: 0, elapsedSeconds: 0 },
  analysisPoints: { count: 0, estimateSeconds: 0, elapsedSeconds: 0 },
};

export const fakeRow = (key: string, patch: Partial<TaskRow> = {}): TaskRow => ({
  key,
  title: `Subtarea ${key}`,
  status: 'Por hacer',
  category: 'new',
  assignee: 'Ana Pérez',
  estimateSeconds: 3600,
  dueDate: '2026-11-05',
  inPlan: true,
  missing: false,
  pendingDone: false,
  realClaudeSeconds: null,
  realElapsedSeconds: null,
  ...patch,
});

export interface FakeTasksOptions {
  rows?: TaskRow[];
  start?: TransitionOutcome[];
  finish?: TransitionOutcome[];
  returnOptions?: string[];
  removeResults?: Record<string, DeleteResult>;
  myDay?: MyDayModel;
  calibration?: CalibrationModel;
  // Planificación al entrar a una historia; sin `planningOpen` no hay ninguna abierta
  planningOpen?: string | null;
  planningOutcome?: PlanningOutcome;
  // Gestión del proyecto a la que iría la Planificación; sin ella va en la misma historia
  managementKey?: string;
}

// Puente de tareas falso en memoria: registra lo que la pantalla pide, sin Jira ni disco
export function createFakeTasks(options: FakeTasksOptions = {}) {
  let rows = options.rows ?? [fakeRow('AQ-101'), fakeRow('AQ-102', { status: 'En curso', category: 'indeterminate' })];
  const calls = {
    started: [] as Array<{ key: string; options: TransitionOptions }>,
    finished: [] as Array<{ key: string; options: TransitionOptions }>,
    returned: [] as Array<{ key: string; name: string }>,
    removed: [] as string[][],
    retried: 0,
    loads: 0,
    planning: [] as Array<{ storyKey: string; input: PlanningInput }>,
  };
  const startOutcomes = [...(options.start ?? [])];
  const finishOutcomes = [...(options.finish ?? [])];
  const tasks: TasksBridge = {
    load: async (storyKey) => (calls.loads++, { storyKey, summary: 'Login social', rows }),
    start: async (storyKey, key, opts) => {
      calls.started.push({ key, options: opts });
      return startOutcomes.shift() ?? { kind: 'ok', storyKey };
    },
    startMyDay: async (key, parentKey, opts) => {
      calls.started.push({ key, options: opts });
      return startOutcomes.shift() ?? { kind: 'ok', storyKey: parentKey };
    },
    finish: async ({ storyKey, issueKey }, opts) => {
      calls.finished.push({ key: issueKey, options: opts });
      return finishOutcomes.shift() ?? { kind: 'ok', storyKey };
    },
    finishMyDay: async (key, parentKey, opts) => {
      calls.finished.push({ key, options: opts });
      return finishOutcomes.shift() ?? { kind: 'ok', storyKey: parentKey };
    },
    retryPending: async () => (calls.retried++, { finished: ['AQ-102'], failed: [] }),
    returnOptions: async () => options.returnOptions ?? ['Backlog', 'Por hacer'],
    returnTo: async (key, name) => {
      calls.returned.push({ key, name });
      rows = rows.map((r) => (r.key === key ? { ...r, status: name, category: 'new' } : r));
    },
    remove: async (_storyKey, keys) => {
      calls.removed.push(keys);
      const results = keys.map((key) => options.removeResults?.[key] ?? { key, ok: true });
      const gone = new Set(results.filter((r) => r.ok).map((r) => r.key));
      rows = rows.filter((r) => !gone.has(r.key));
      return results;
    },
    myDay: async () => options.myDay ?? { rows: [], totalSeconds: 0, capacitySeconds: 8 * SECONDS_PER_HOUR },
    calibration: async () => options.calibration ?? EMPTY_CALIBRATION,
    planningStatus: async () => ({ open: options.planningOpen ?? null, managementKey: options.managementKey ?? null }),
    planningSuggestion: async () => ({ estimate: '1h', dueDate: 'hoy', measured: 0 }),
    createPlanning: async (storyKey, input) => {
      calls.planning.push({ storyKey, input });
      return options.planningOutcome ?? { ok: true, issueKey: 'AQ-150', started: true };
    },
    openInBrowser: async () => undefined,
  };
  return { tasks, calls };
}

export interface FakeManagementOptions {
  // Valor inicial por proyecto; sin entrada, 'unset'
  status?: Record<string, ManagementStatus>;
  saveError?: string;
}

// Puente de gestión falso en memoria: guarda como el real, sin disco ni Jira
export function createFakeManagement(options: FakeManagementOptions = {}) {
  const values = new Map<string, ManagementStatus>(Object.entries(options.status ?? {}));
  const calls = { saved: [] as Array<{ projectKey: string; key: string | null }>, statusReads: [] as string[] };
  const management: ManagementBridge = {
    status: async (projectKey) => {
      calls.statusReads.push(projectKey);
      return values.get(projectKey) ?? 'unset';
    },
    save: async (projectKey, key) => {
      calls.saved.push({ projectKey, key });
      if (options.saveError) return { ok: false, message: options.saveError };
      values.set(projectKey, key === null ? 'none' : { key, summary: `Resumen de ${key}` });
      return { ok: true };
    },
  };
  return { management, calls };
}

export interface FakeAnalysisOptions {
  detail?: Partial<AnalysisDetail>;
  // Tarea de análisis ya abierta al entrar; sin ella no hay ninguna
  trackingOpen?: string | null;
  managementKey?: string;
  // Respuestas sucesivas de createTracking; al agotarse, éxito
  trackingOutcomes?: PlanningOutcome[];
  createError?: string;
  addError?: string;
  results?: SourceResult[];
  // Mensaje con el que remove se niega; sin él borra
  removeError?: string;
  // Puntos del análisis; sin ellos no hay puntos.json
  pointRows?: PointRow[];
  // Épica ya vinculada al abrir el vínculo
  linkEpicKey?: string | null;
  // Clave -> resultado de resolveTarget; una clave ausente se acepta (épica si está en `epics`)
  linkTargets?: Record<string, LinkTargetOutcome>;
  // Resultados de create; sin ellos cada punto crea AQ-<100+n>
  linkResults?: LinkPointResult[];
  // Mensaje de aviso que devuelven finish y giveBack (Jira no se movió)
  pointNotice?: string;
  // Transiciones que Jira ofrece cuando no reconoce la de iniciar o finalizar un punto vinculado
  startChoose?: string[];
  finishChoose?: string[];
  // Resultados sucesivos de link.sync; al agotarse, sin cambios
  syncResults?: LinkPointResult[][];
  // Transiciones que ofrece Jira al devolver un punto vinculado
  returnOptions?: string[];
  // Estado de los puntos: 'invalid' simula un puntos.json con errores
  pointsInvalid?: string;
}

export const fakePointRow = (id: string, patch: Partial<PointRow> = {}): PointRow => ({
  id,
  title: `Punto ${id}`,
  status: 'pending',
  estimateSeconds: 3600,
  realClaudeSeconds: null,
  realElapsedSeconds: null,
  issueKey: null,
  ...patch,
});

// Puente de análisis falso en memoria: registra lo que la pantalla pide, sin disco ni Jira
export function createFakeAnalysis(options: FakeAnalysisOptions = {}) {
  const detail: AnalysisDetail = {
    id: 'an-1',
    name: 'Observaciones',
    sources: [],
    tracking: [],
    documented: false,
    ...options.detail,
  };
  const calls = {
    removed: [] as string[],
    created: [] as NewAnalysisInput[],
    added: [] as Array<{ id: string; input: SourcesInput }>,
    tracking: [] as Array<{ id: string; input: PlanningInput; whereKey: string | null }>,
    pointStarted: [] as Array<{ id: string; pointId: string; reopen: boolean }>,
    pointFinished: [] as string[],
    pointGivenBack: [] as Array<{ pointId: string; transitionName: string | undefined }>,
    finishTransitions: [] as Array<string | undefined>,
    startTransitions: [] as Array<string | undefined>,
    linkSynced: [] as Array<{ target: 'start' | 'done'; name: string } | undefined>,
    linkEpics: [] as Array<string | null>,
    linkCreated: [] as Array<Record<string, string>>,
    linkResolved: [] as Array<{ key: string; mustBeEpic: boolean }>,
  };
  let linkEpicKey = options.linkEpicKey ?? null;
  const syncOutcomes = [...(options.syncResults ?? [])];
  const rows = options.pointRows?.map((row) => ({ ...row }));
  const rowOf = (pointId: string): PointRow | undefined => rows?.find((row) => row.id === pointId);
  const pointsModel = (): PointsModel => {
    const base = { id: detail.id, name: detail.name };
    if (options.pointsInvalid) return { kind: 'invalid', ...base, message: options.pointsInvalid };
    return rows ? { kind: 'ready', ...base, rows: rows.map((row) => ({ ...row })) } : { kind: 'missing', ...base };
  };
  const outcomes = [...(options.trackingOutcomes ?? [])];
  const analysis: AnalysisBridge = {
    points: {
      load: async () => pointsModel(),
      start: async (id, pointId, startOptions): Promise<PointStartOutcome> => {
        const row = rowOf(pointId);
        if (row?.status === 'done' && !startOptions.reopen) return { kind: 'needs-reopen' };
        calls.pointStarted.push({ id, pointId, reopen: startOptions.reopen === true });
        if (row) row.status = 'started';
        if (options.startChoose && !startOptions.transitionName) return { kind: 'choose', available: options.startChoose };
        calls.startTransitions.push(startOptions.transitionName);
        return { kind: 'ok' };
      },
      finish: async (_id, pointId, transitionName) => {
        calls.pointFinished.push(pointId);
        const row = rowOf(pointId);
        if (row) row.status = 'done';
        calls.finishTransitions.push(transitionName);
        const choose = options.finishChoose && !transitionName ? options.finishChoose : undefined;
        return { notice: options.pointNotice ?? null, ...(choose ? { choose } : {}) };
      },
      returnOptions: async () => options.returnOptions ?? [],
      giveBack: async (_id, pointId, transitionName) => {
        calls.pointGivenBack.push({ pointId, transitionName });
        const row = rowOf(pointId);
        if (row) row.status = 'pending';
        return options.pointNotice ?? null;
      },
    },
    link: {
      load: async () => ({ epicKey: linkEpicKey, points: pointsModel() }),
      resolveTarget: async (_id, key, mustBeEpic) => {
        calls.linkResolved.push({ key, mustBeEpic });
        const childKind = mustBeEpic ? 'standard' : 'subtask';
        return options.linkTargets?.[key] ?? { ok: true, target: { key, summary: `Resumen de ${key}`, childKind } };
      },
      setEpic: async (_id, epicKey) => {
        calls.linkEpics.push(epicKey);
        linkEpicKey = epicKey;
      },
      sync: async (_id, choice) => {
        calls.linkSynced.push(choice);
        return syncOutcomes.shift() ?? [];
      },
      create: async (_id, targets) => {
        calls.linkCreated.push(targets);
        return (
          options.linkResults ??
          Object.keys(targets).map((pointId, n) => ({ pointId, ok: true, issueKey: `AQ-${100 + n}` }))
        );
      },
    },
    create: async (input) => {
      if (options.createError) return { ok: false, message: options.createError };
      calls.created.push(input);
      detail.name = input.name;
      return { ok: true, id: detail.id, results: options.results ?? [] };
    },
    load: async () => ({ ...detail, sources: [...detail.sources] }),
    addSources: async (id, input) => {
      if (options.addError) return { ok: false, message: options.addError };
      calls.added.push({ id, input });
      const now = new Date().toISOString();
      if (input.paths.trim()) detail.sources.push({ file: input.paths.trim(), origin: 'file', addedAt: now });
      return { ok: true, results: options.results ?? [] };
    },
    remove: async (id) => {
      if (options.removeError) return { ok: false, message: options.removeError };
      calls.removed.push(id);
      return { ok: true };
    },
    trackingStatus: async () => ({ open: options.trackingOpen ?? null, managementKey: options.managementKey ?? null }),
    trackingSuggestion: async () => ({ estimate: '1h', dueDate: 'hoy', measured: 0 }),
    createTracking: async (id, input, whereKey) => {
      calls.tracking.push({ id, input, whereKey });
      const outcome = outcomes.shift() ?? { ok: true as const, issueKey: 'AQ-160', started: true };
      if (outcome.ok) detail.tracking.push({ issueKey: outcome.issueKey, status: 'started' });
      return outcome;
    },
  };
  return { analysis, calls, detail };
}
