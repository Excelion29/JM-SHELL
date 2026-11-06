import type {
  ChatBridge,
  ChatHeader,
  ChatLine,
  ChatUiEvent,
  KnowledgeChoice,
  KnowledgeConnection,
  KnowledgeListing,
  KnowledgeStatus,
  KnowledgeSummary,
  ServerInspection,
} from '../refinement/chat-types.js';
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
  DeleteResult,
  MyDayModel,
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
    listed: [] as Array<{ connection: KnowledgeConnection; dir: string }>,
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
  ...patch,
});

export interface FakeTasksOptions {
  rows?: TaskRow[];
  start?: TransitionOutcome[];
  finish?: TransitionOutcome[];
  returnOptions?: string[];
  removeResults?: Record<string, DeleteResult>;
  myDay?: MyDayModel;
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
    openInBrowser: async () => undefined,
  };
  return { tasks, calls };
}
