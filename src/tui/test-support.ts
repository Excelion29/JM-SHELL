import type { ChatBridge, ChatHeader, ChatLine, ChatUiEvent } from '../refinement/chat-types.js';
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
import type { TaskEstimate } from '../refinement/types.js';

const WAIT_TIMEOUT_MS = 2000;
const WAIT_POLL_MS = 15;

// Espera a que se cumpla una condición (el render y los puentes falsos son asíncronos)
export async function waitFor(condition: () => boolean, what = 'la condición', timeoutMs = WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Se agotó el tiempo esperando ${what}`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

export const FAKE_CODE_FOLDER = 'C:\repo\jm';

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
export function createFakeChat(
  header: Partial<ChatHeader> = {},
  history: ChatLine[] = [],
) {
  const sent: string[] = [];
  const calls = {
    opened: [] as string[],
    toggle: 0,
    newSession: 0,
    close: 0,
  };
  let listener: ((event: ChatUiEvent) => void) | null = null;
  const chat: ChatBridge = {
    open: async (key, onEvent) => {
      listener = onEvent;
      calls.opened.push(key);
      return { header: { ...BASE_HEADER, ...header, key }, codeFolder: FAKE_CODE_FOLDER, history };
    },
    send: (text) => void sent.push(text),
    toggleDeep: () => void (calls.toggle += 1),
    newSession: () => void (calls.newSession += 1),
    close: async () => void (calls.close += 1),
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
  ...patch,
});

function withTotals(model: ReviewModel): ReviewModel {
  const included = model.tasks.filter((t) => t.include);
  return {
    ...model,
    totals: {
      taskCount: included.length,
      expectedSeconds: included.reduce((sum, t) => sum + t.expectedSeconds, 0),
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
    tasks: options.tasks ?? [fakeTask('T1'), fakeTask('T2', { expectedSeconds: 7200, stdDevSeconds: 1800 })],
    files: options.files ?? [],
    totals: { taskCount: 0, expectedSeconds: 0, stdDevSeconds: 0 },
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
          if (patch.estimate) {
            const preview = fakePreview(patch.estimate) as Extract<EstimatePreview, { ok: true }>;
            Object.assign(next, { estimate: patch.estimate, expectedSeconds: preview.expectedSeconds, stdDevSeconds: preview.stdDevSeconds });
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
            ? { ...f, taskIds: f.taskIds.includes(taskId) ? f.taskIds.filter((id) => id !== taskId) : [...f.taskIds, taskId] }
            : f,
        ),
      };
      return model;
    },
    openAttachment: async (_key, file) => void calls.openedFiles.push(file),
    prepareCreate: async () => ({
      taskCount: model.totals.taskCount,
      expectedSeconds: model.totals.expectedSeconds,
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
      const outcomes = options.outcomes ?? [{ ok: true, created: [], parentKey: request.target.parentKey, estimateSkipped: false }];
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
