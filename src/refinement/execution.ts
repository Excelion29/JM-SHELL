import type { JiraIssue, JiraTransition } from '../config/types';
import type { JiraService } from '../services/jira';
import { adfToMarkdown } from '../utils/adf';
import { effectiveSeconds } from './pert';
import { loadPlan } from './plan';
import { DAILY_CAPACITY_SECONDS, todayIso } from './schedule';
import { advancePhase, assertKey, LOG_FILE, readState, updateState } from './state';
import type { StoryStore } from './story-store';
import type {
  DeleteResult,
  MyDayModel,
  PendingRetry,
  StatusCategory,
  TaskRow,
  TasksModel,
  TransitionOptions,
  TransitionOutcome,
} from './tasks-types';
import type { PlannedTask, RefinementPlan, StoryState } from './types';

export type ExecutionJira = Pick<
  JiraService,
  'getIssue' | 'getIssueWithDescription' | 'getTransitions' | 'doTransition' | 'searchIssues' | 'deleteIssue'
>;

export interface ExecutionContext {
  jira: ExecutionJira;
  // null: tarea suelta de "Mi día", sin historia de jm donde guardar nada
  store: StoryStore | null;
  now?: () => Date;
}

// En el proyecto el estado de trabajo se llama "En curso"; el de terminado, "Finalizada"
export const START_STATUSES = ['En curso', 'In Progress'];
export const DONE_STATUSES = ['Finalizada', 'Done', 'Listo'];
export const MY_DAY_LIMIT = 50;
export const TASK_CONTEXT_DIR = 'tareas';
const LOG_TAIL_CHARS = 3000;
const ROW_FIELDS = ['summary', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'issuetype', 'parent'];
const CATEGORIES: readonly StatusCategory[] = ['new', 'indeterminate', 'done'];
const MY_DAY_JQL = 'assignee = currentUser() AND duedate <= now() AND statusCategory != Done ORDER BY duedate';

export const taskContextName = (issueKey: string): string => {
  assertKey(issueKey);
  return `${TASK_CONTEXT_DIR}/${issueKey}.md`;
};

export function categoryOf(issue: JiraIssue): StatusCategory {
  const key = issue.fields.status.statusCategory?.key;
  return CATEGORIES.find((category) => category === key) ?? 'unknown';
}

const messageOf = (err: unknown): string => (err as Error).message;

function findTransition(transitions: JiraTransition[], names: string[]): JiraTransition | undefined {
  for (const name of names) {
    const needle = name.toLowerCase();
    const hit = transitions.find((t) => t.name.toLowerCase() === needle || t.to?.name.toLowerCase() === needle);
    if (hit) return hit;
  }
  return undefined;
}

type Applied = { ok: true } | { ok: false; available: string[] };

async function applyTransition(
  jira: ExecutionJira,
  issueKey: string,
  names: string[],
  chosen?: string,
): Promise<Applied> {
  const transitions = await jira.getTransitions(issueKey);
  const match = chosen ? transitions.find((t) => t.name === chosen) : findTransition(transitions, names);
  if (!match) return { ok: false, available: transitions.map((t) => t.name) };
  await jira.doTransition(issueKey, match.id);
  return { ok: true };
}

const NO_TRANSITIONS_MESSAGE = 'Jira no ofrece ninguna transición para esta tarea desde su estado actual.';

const unmatched = (available: string[]): TransitionOutcome =>
  available.length > 0 ? { kind: 'choose', available } : { kind: 'failed', message: NO_TRANSITIONS_MESSAGE };

async function recordStart(ctx: ExecutionContext, storyKey: string, issueKey: string): Promise<void> {
  const startedAt = (ctx.now?.() ?? new Date()).toISOString();
  const store = ctx.store as StoryStore;
  await updateState(store, storyKey, (state) => {
    const previous = state.taskRuns[issueKey];
    if (previous && previous.status !== 'done') return;
    state.taskRuns[issueKey] = {
      issueKey,
      claudeSessionId: previous?.claudeSessionId ?? null,
      startedAt,
      finishedAt: null,
      activeMs: previous?.activeMs ?? 0,
      status: 'started',
    };
  });
  await advancePhase(store, storyKey, 'in-progress');
}

export async function startTask(
  ctx: ExecutionContext,
  storyKey: string | null,
  issueKey: string,
  options: TransitionOptions = {},
): Promise<TransitionOutcome> {
  try {
    assertKey(issueKey);
    const category = categoryOf(await ctx.jira.getIssue(issueKey));
    if (category === 'done' && !options.reopen) return { kind: 'needs-reopen' };
    if (category !== 'indeterminate') {
      const applied = await applyTransition(ctx.jira, issueKey, START_STATUSES, options.transitionName);
      if (!applied.ok) return unmatched(applied.available);
    }
    if (ctx.store && storyKey) await recordStart(ctx, storyKey, issueKey);
    return { kind: 'ok', storyKey };
  } catch (err: unknown) {
    return { kind: 'failed', message: messageOf(err) };
  }
}

async function markPendingDone(ctx: ExecutionContext, storyKey: string, issueKey: string): Promise<void> {
  const finishedAt = (ctx.now?.() ?? new Date()).toISOString();
  await updateState(ctx.store as StoryStore, storyKey, (state) => {
    const run = state.taskRuns[issueKey] ?? {
      issueKey,
      claudeSessionId: null,
      startedAt: finishedAt,
      finishedAt: null,
      activeMs: 0,
      status: 'started' as const,
    };
    run.finishedAt = run.finishedAt ?? finishedAt;
    run.pendingDone = true;
    state.taskRuns[issueKey] = run;
  });
}

async function clearPendingDone(ctx: ExecutionContext, storyKey: string, issueKey: string): Promise<void> {
  await updateState(ctx.store as StoryStore, storyKey, (state) => {
    const run = state.taskRuns[issueKey];
    if (!run) return;
    delete run.pendingDone;
    if (run.status !== 'done') run.finishedAt = null;
  });
}

async function markDone(ctx: ExecutionContext, storyKey: string, issueKey: string): Promise<void> {
  await updateState(ctx.store as StoryStore, storyKey, (state) => {
    const run = state.taskRuns[issueKey];
    if (!run) return;
    run.status = 'done';
    delete run.pendingDone;
  });
}

const PENDING_NOTE = 'Guardé el cierre en tu equipo; pulsa r en Tareas para reintentarlo cuando Jira responda.';

// Pasa a "Finalizada" y nunca toca la estimación original: solo la transición
export async function finishTask(
  ctx: ExecutionContext,
  storyKey: string | null,
  issueKey: string,
  options: TransitionOptions = {},
): Promise<TransitionOutcome> {
  const tracked = Boolean(ctx.store && storyKey);
  try {
    assertKey(issueKey);
    if (tracked) await markPendingDone(ctx, storyKey as string, issueKey);
    const applied = await applyTransition(ctx.jira, issueKey, DONE_STATUSES, options.transitionName);
    // Sin transición a Finalizada el dev decide en el selector: no queda un cierre pendiente que `r` aplique solo
    if (!applied.ok) {
      if (tracked) await clearPendingDone(ctx, storyKey as string, issueKey);
      return unmatched(applied.available);
    }
    if (tracked) await markDone(ctx, storyKey as string, issueKey);
    return { kind: 'ok', storyKey };
  } catch (err: unknown) {
    return { kind: 'failed', message: tracked ? `${messageOf(err)} ${PENDING_NOTE}` : messageOf(err) };
  }
}

export async function retryPending(ctx: ExecutionContext, storyKey: string): Promise<PendingRetry> {
  const state = await readState(ctx.store as StoryStore, storyKey);
  const pending = Object.values(state?.taskRuns ?? {}).filter((run) => run.pendingDone);
  const result: PendingRetry = { finished: [], failed: [] };
  for (const run of pending) {
    const outcome = await finishTask(ctx, storyKey, run.issueKey);
    (outcome.kind === 'ok' ? result.finished : result.failed).push(run.issueKey);
  }
  return result;
}

// Solo las "En curso" se devuelven: las demás no lo necesitan o están finalizadas
export async function returnOptions(jira: ExecutionJira, issueKey: string): Promise<string[]> {
  assertKey(issueKey);
  if (categoryOf(await jira.getIssue(issueKey)) !== 'indeterminate') {
    throw new Error(`${issueKey} no está en curso: no hay nada que devolver.`);
  }
  return (await jira.getTransitions(issueKey)).map((t) => t.name);
}

export async function returnTo(jira: ExecutionJira, issueKey: string, transitionName: string): Promise<void> {
  const applied = await applyTransition(jira, issueKey, [], transitionName);
  if (!applied.ok) throw new Error(`Jira ya no ofrece la transición "${transitionName}" para ${issueKey}.`);
}

const BLOCKED_BY_CATEGORY: Partial<Record<StatusCategory, string>> = {
  done: 'está finalizada: no se borra',
  indeterminate: 'está en curso: devuélvela a un estado anterior (b) antes de borrarla',
};

async function deleteOne(jira: ExecutionJira, storyKey: string, key: string): Promise<DeleteResult> {
  try {
    assertKey(key);
    const issue = await jira.getIssue(key);
    if (issue.fields.parent?.key !== storyKey) return { key, ok: false, message: `no es subtarea de ${storyKey}` };
    const blocked = BLOCKED_BY_CATEGORY[categoryOf(issue)];
    if (blocked) return { key, ok: false, message: blocked };
    await jira.deleteIssue(key);
    return { key, ok: true };
  } catch (err: unknown) {
    return { key, ok: false, message: messageOf(err) };
  }
}

// Un fallo (p. ej. sin permiso) se reporta por tarea y no corta las demás
export async function deleteTasks(ctx: ExecutionContext, storyKey: string, keys: string[]): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];
  for (const key of keys) results.push(await deleteOne(ctx.jira, storyKey, key));
  const removed = new Set(results.filter((r) => r.ok).map((r) => r.key));
  if (removed.size > 0 && ctx.store) {
    await updateState(ctx.store, storyKey, (state) => {
      for (const [taskId, issueKey] of Object.entries(state.createdIssues)) {
        if (removed.has(issueKey)) delete state.createdIssues[taskId];
      }
      for (const key of removed) delete state.taskRuns[key];
    });
  }
  return results;
}

function planTaskOf(plan: RefinementPlan | null, state: StoryState, issueKey: string): PlannedTask | undefined {
  const taskId = Object.entries(state.createdIssues).find(([, key]) => key === issueKey)?.[0];
  return plan?.tasks.find((t) => t.id === taskId);
}

async function planOrNull(store: StoryStore): Promise<RefinementPlan | null> {
  try {
    return await loadPlan(store);
  } catch {
    return null; // sin plan.json válido las filas salen solo de Jira
  }
}

function rowFrom(issue: JiraIssue, planTask: PlannedTask | undefined, pendingDone: boolean): TaskRow {
  const { fields } = issue;
  return {
    key: issue.key,
    title: fields.summary || planTask?.summary || issue.key,
    status: fields.status.name,
    category: categoryOf(issue),
    assignee: fields.assignee?.displayName ?? null,
    estimateSeconds: fields.timeoriginalestimate ?? (planTask ? effectiveSeconds(planTask) : null),
    dueDate: fields.duedate ?? planTask?.dueDate ?? null,
    inPlan: Boolean(planTask),
    missing: false,
    pendingDone,
  };
}

function missingRow(issueKey: string, planTask: PlannedTask | undefined, pendingDone: boolean): TaskRow {
  return {
    key: issueKey,
    title: planTask?.summary ?? issueKey,
    status: '',
    category: 'unknown',
    assignee: null,
    estimateSeconds: planTask ? effectiveSeconds(planTask) : null,
    dueDate: planTask?.dueDate ?? null,
    inPlan: Boolean(planTask),
    missing: true,
    pendingDone,
  };
}

// Todas las subtareas de la historia según Jira, más las del registro que Jira ya no devuelve
export async function loadTaskRows(ctx: ExecutionContext, storyKey: string): Promise<TasksModel> {
  assertKey(storyKey);
  const store = ctx.store as StoryStore;
  const state = await readState(store, storyKey);
  if (!state) throw new Error(`La historia ${storyKey} aún no tiene estado.`);
  const plan = await planOrNull(store);
  const issues = await ctx.jira.searchIssues(`parent = ${storyKey} ORDER BY created ASC`, ROW_FIELDS);
  const pending = (key: string) => state.taskRuns[key]?.pendingDone === true;
  const rows = issues.map((issue) => rowFrom(issue, planTaskOf(plan, state, issue.key), pending(issue.key)));
  const seen = new Set(rows.map((row) => row.key));
  for (const key of Object.values(state.createdIssues)) {
    if (!seen.has(key)) rows.push(missingRow(key, planTaskOf(plan, state, key), pending(key)));
  }
  return { storyKey, summary: state.summary, rows };
}

export interface TaskContextInput {
  storyKey: string | null;
  issueKey: string;
  title: string;
  description: string;
  doneCriteria: string[];
  logTail: string;
  noteHint: string | null;
  previous: Array<{ key: string; title: string }>;
}

// Sin PIN, claves de API, URL del intermediario ni contenido de .jira.json: solo lo que hace falta para trabajar la tarea
export function renderTaskContext(input: TaskContextInput): string {
  const lines = [`# ${input.issueKey} · ${input.title}`, ''];
  if (input.storyKey) lines.push(`Historia: ${input.storyKey}`, '');
  lines.push('## Descripción', '', input.description || '_Sin descripción._', '');
  if (input.doneCriteria.length > 0) {
    lines.push('## Criterio de terminado', '', ...input.doneCriteria.map((item) => `- ${item}`), '');
  }
  if (input.noteHint) lines.push('## Nota de la historia', '', input.noteHint, '');
  if (input.previous.length > 0) {
    lines.push(
      '## Tareas anteriores (ya terminadas)',
      '',
      ...input.previous.map((p) => `- ${p.key} · ${p.title} (su detalle está en ${taskContextName(p.key)})`),
      '',
    );
  }
  if (input.logTail.trim()) lines.push('## Bitácora reciente', '', input.logTail.trim(), '');
  return lines.join('\n');
}

// Arma el contexto de la tarea; con historia lo deja también en tareas/<ISSUE>.md de su almacén
export async function prepareTaskContext(
  ctx: ExecutionContext,
  storyKey: string | null,
  issueKey: string,
  noteHint: string | null,
): Promise<string> {
  const issue = await ctx.jira.getIssueWithDescription(issueKey);
  const base = {
    storyKey,
    issueKey,
    title: issue.fields.summary,
    description: adfToMarkdown(issue.fields.description as Parameters<typeof adfToMarkdown>[0]),
    noteHint,
  };
  if (!ctx.store || !storyKey) {
    return renderTaskContext({ ...base, doneCriteria: [], logTail: '', previous: [] });
  }
  const state = await readState(ctx.store, storyKey);
  const plan = await planOrNull(ctx.store);
  const titleOf = (key: string) => (state && planTaskOf(plan, state, key)?.summary) || key;
  const previous = Object.values(state?.taskRuns ?? {})
    .filter((run) => run.status === 'done' && run.issueKey !== issueKey)
    .map((run) => ({ key: run.issueKey, title: titleOf(run.issueKey) }));
  const log = (await ctx.store.readText(LOG_FILE)) ?? '';
  const text = renderTaskContext({
    ...base,
    doneCriteria: (state && planTaskOf(plan, state, issueKey)?.doneCriteria) || [],
    logTail: log.slice(-LOG_TAIL_CHARS),
    previous,
  });
  await ctx.store.writeText(taskContextName(issueKey), text);
  return text;
}

export async function loadMyDay(jira: ExecutionJira, now: Date = new Date()): Promise<MyDayModel> {
  const today = todayIso(now);
  const issues = (await jira.searchIssues(MY_DAY_JQL, ROW_FIELDS)).slice(0, MY_DAY_LIMIT);
  const rows = issues.map((issue) => ({
    key: issue.key,
    title: issue.fields.summary,
    parentKey: issue.fields.parent?.key ?? null,
    status: issue.fields.status.name,
    category: categoryOf(issue),
    estimateSeconds: issue.fields.timeoriginalestimate,
    dueDate: issue.fields.duedate,
    overdue: issue.fields.duedate !== null && issue.fields.duedate < today,
  }));
  const totalSeconds = rows.reduce((sum, row) => sum + (row.estimateSeconds ?? 0), 0);
  return { rows, totalSeconds, capacitySeconds: DAILY_CAPACITY_SECONDS };
}
