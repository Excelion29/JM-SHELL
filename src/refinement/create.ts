import type { JiraService } from '../services/jira';
import { IssueNotFoundError } from '../services/jira';
import type { JiraIssue } from '../config/types';
import { markdownToAdf } from '../utils/adf';
import { getAvailableTypes, getLevel, IssueTypeInfo, isEpicType } from '../utils/issueTypes';
import { formatSeconds } from '../utils/time';
import { MAX_ATTACHMENT_BYTES } from './attachments';
import { loadPlan } from './plan';
import { effectiveSeconds, taskExpectedSeconds } from './pert';
import { scheduleOf, todayIso } from './schedule';
import { listLocalEntries, readAttachment } from './review';
import type {
  AssigneeView,
  CreateOutcome,
  CreatedTask,
  CreatePreview,
  ExistingMatch,
  CreateProgress,
  CreateRequest,
  CreationTarget,
  ParentOutcome,
  PlannedUpload,
  TargetResult,
} from './review-types';
import { advancePhase, assertKey, readState, updateState } from './state';
import type { StoryStore } from './story-store';
import { projectKeyOfStory } from './repos';
import { PlannedTask, RefinementPlan, Risk, StoryState } from './types';

export { ESTIMATE_ROUND_SECONDS, estimateForJira } from './pert';
const DONE_CATEGORY = 'done';
const SUBTASK_TYPE_PREFERENCE = /sub-?tarea|sub-?task/i;
const STANDARD_TYPE_PREFERENCE = /^(tarea|task)$/i;
const CHILDREN_FIELDS = ['summary'];
const NEWLINES = /\s*[\r\n]+\s*/g;

export type CreateJira = Pick<
  JiraService,
  'getIssue' | 'getIssueTypes' | 'createIssue' | 'uploadAttachment' | 'searchAllIssues' | 'getAttachments'
>;

const RISK_LABELS: Record<Risk, string> = { low: 'bajo', medium: 'medio', high: 'alto' };

// Un salto de línea dentro de un ítem rompería la lista del markdown
export const oneLine = (text: string): string => text.replace(NEWLINES, ' ').trim();

export function buildDescriptionMarkdown(task: PlannedTask): string {
  const { optimistic, likely, pessimistic } = task.estimate;
  const expected = formatSeconds(Math.round(taskExpectedSeconds(task)));
  const parts: string[] = [];
  if (task.description.trim()) parts.push(task.description.trim());
  if (task.doneCriteria.length) {
    parts.push(['## Criterio de terminado', ...task.doneCriteria.map((item) => `- ${oneLine(item)}`)].join('\n'));
  }
  const final = task.finalEstimate?.trim();
  const estimateLine = final
    ? `Estimación: ${final} (del dev) · PERT: O ${optimistic} / M ${likely} / P ${pessimistic}, esperado ${expected}`
    : `Estimación: ${optimistic} / ${likely} / ${pessimistic} · esperado ${expected}`;
  parts.push(`${estimateLine} · riesgo ${RISK_LABELS[task.risk]}`);
  return parts.join('\n\n');
}

function pickType(types: IssueTypeInfo[], preference: RegExp): IssueTypeInfo {
  return types.find((t) => preference.test(t.name)) ?? types[0];
}

async function targetFromIssue(jira: CreateJira, issue: JiraIssue): Promise<CreationTarget> {
  const level = getLevel({ issueKey: issue.key, issueType: issue.fields.issuetype?.name });
  if (level === 'subtask') throw new Error(`${issue.key} es una subtarea: no se pueden crear tareas dentro de ella.`);
  const types = await getAvailableTypes(jira, projectKeyOfStory(issue.key), level);
  if (!types.length) throw new Error(`No encontré un tipo de issue para crear tareas dentro de ${issue.key}.`);
  const isEpic = level === 'epic';
  const type = pickType(types, isEpic ? STANDARD_TYPE_PREFERENCE : SUBTASK_TYPE_PREFERENCE);
  return {
    parentKey: issue.key,
    parentSummary: issue.fields.summary,
    childKind: isEpic ? 'standard' : 'subtask',
    issueTypeId: type.id,
    issueTypeName: type.name,
  };
}

// Destino elegido a mano: la épica o la clave que el dev escribió
export async function resolveTarget(jira: CreateJira, parentKey: string): Promise<TargetResult> {
  try {
    assertKey(parentKey);
    return { ok: true, target: await targetFromIssue(jira, await jira.getIssue(parentKey)) };
  } catch (err: unknown) {
    const message = err instanceof IssueNotFoundError ? `No encontré ${parentKey} en Jira.` : (err as Error).message;
    return { ok: false, message };
  }
}

function epicOf(issue: JiraIssue): { key: string; summary: string } | null {
  const parent = issue.fields.parent;
  return parent && isEpicType(parent.fields.issuetype?.name ?? '')
    ? { key: parent.key, summary: parent.fields.summary }
    : null;
}

// Subtareas bajo la historia si es una historia viva; en cualquier otro caso se pregunta dónde crear
export async function resolveParent(jira: CreateJira, storyKey: string): Promise<ParentOutcome> {
  let issue: JiraIssue;
  try {
    issue = await jira.getIssue(storyKey);
  } catch (err: unknown) {
    if (err instanceof IssueNotFoundError)
      return { kind: 'ask', reason: 'not-found', epicKey: null, epicSummary: null };
    throw err;
  }
  const level = getLevel({ issueKey: issue.key, issueType: issue.fields.issuetype?.name });
  if (level === 'epic') {
    return { kind: 'ask', reason: 'epic', epicKey: issue.key, epicSummary: issue.fields.summary };
  }
  if (level === 'subtask') return { kind: 'ask', reason: 'subtask', epicKey: null, epicSummary: null };
  if (issue.fields.status.statusCategory?.key === DONE_CATEGORY) {
    const epic = epicOf(issue);
    return { kind: 'ask', reason: 'done', epicKey: epic?.key ?? null, epicSummary: epic?.summary ?? null };
  }
  return { kind: 'ready', target: await targetFromIssue(jira, issue) };
}

function hasUploadPurpose(entry: StoryState['attachments'][number]): boolean {
  return entry.purpose === 'evidence' || entry.purpose === 'team';
}

function isAssigned(entry: StoryState['attachments'][number], task: PlannedTask): boolean {
  return entry.taskIds.includes(task.id) || task.attachments.includes(entry.file);
}

// Solo tareas marcadas y archivos con propósito evidencia/equipo
export function plannedUploads(state: StoryState, plan: RefinementPlan): PlannedUpload[] {
  const included = plan.tasks.filter((t) => t.include);
  return state.attachments.filter(hasUploadPurpose).flatMap((entry) => {
    const taskIds = included.filter((t) => isAssigned(entry, t)).map((t) => t.id);
    return taskIds.length ? [{ file: entry.file, purpose: entry.purpose, taskIds }] : [];
  });
}

export type AssigneeJira = Pick<JiraService, 'getMyself' | 'getAssignableUsers'>;

// Yo primero y luego el resto de usuarios asignables, sin repetir
export async function listAssignees(jira: AssigneeJira, projectKey: string): Promise<AssigneeView[]> {
  const me = await jira.getMyself();
  let others: AssigneeView[] = [];
  try {
    others = (await jira.getAssignableUsers(projectKey)).filter((u) => u.accountId !== me.accountId);
  } catch {
    // sin la lista solo se ofrece el usuario actual: crear no depende de ella
  }
  return [
    { accountId: me.accountId, displayName: me.displayName },
    ...others.map(({ accountId, displayName }) => ({ accountId, displayName })),
  ];
}

export async function defaultAssignee(
  jira: AssigneeJira,
  projectKey: string,
  configuredId: string | null,
): Promise<AssigneeView> {
  const users = await listAssignees(jira, projectKey);
  return (
    users.find((u) => u.accountId === configuredId) ??
    (configuredId ? { accountId: configuredId, displayName: configuredId } : users[0])
  );
}

// Hijos del padre: con subtareas se lee el campo `subtasks` del propio issue (consistente al instante);
// el índice de búsqueda puede ir atrasado justo tras crear
async function childrenOf(jira: CreateJira, target: CreationTarget): Promise<Array<{ key: string; summary: string }>> {
  if (target.childKind === 'subtask') {
    const issue = await jira.getIssue(target.parentKey);
    return (issue.fields.subtasks ?? []).map((s) => ({
      key: s.key,
      summary: s.fields.summary,
    }));
  }
  assertKey(target.parentKey);
  const found = await jira.searchAllIssues(`parent = "${target.parentKey}"`, CHILDREN_FIELDS);
  return found.map((c) => ({ key: c.key, summary: c.fields.summary }));
}

// Tareas marcadas cuyo título ya existe bajo el padre (y que esta historia aún no registró): se proponen, no se adoptan solas
export async function findExistingMatches(
  jira: CreateJira,
  store: StoryStore,
  storyKey: string,
  target: CreationTarget,
): Promise<ExistingMatch[]> {
  const tasks = (await loadPlan(store)).tasks.filter((t) => t.include);
  const state = await readState(store, storyKey);
  const known = new Set(Object.values(state?.createdIssues ?? {}));
  const pending = tasks.filter((t) => !state?.createdIssues[t.id]);
  if (!pending.length) return [];
  const bySummary = new Map<string, string>();
  for (const child of await childrenOf(jira, target)) {
    const summary = oneLine(child.summary);
    if (!known.has(child.key) && !bySummary.has(summary)) bySummary.set(summary, child.key);
  }
  const matches: ExistingMatch[] = [];
  for (const task of pending) {
    const summary = oneLine(task.summary);
    const key = bySummary.get(summary);
    if (!key) continue;
    bySummary.delete(summary);
    matches.push({ taskId: task.id, key, summary });
  }
  return matches;
}

export async function buildPreview(
  jira: CreateJira,
  store: StoryStore,
  storyKey: string,
  assignee: CreatePreview['assignee'],
): Promise<CreatePreview> {
  const plan = await loadPlan(store);
  const state = await readState(store, storyKey);
  if (!state) throw new Error(`La historia ${storyKey} aún no tiene estado.`);
  const included = plan.tasks.filter((t) => t.include && !state.createdIssues[t.id]);
  const parent = await resolveParent(jira, storyKey);
  return {
    taskCount: included.length,
    estimateSeconds: included.reduce((sum, t) => sum + effectiveSeconds(t), 0),
    parent,
    assignee,
    uploads: plannedUploads(state, plan),
    existing: parent.kind === 'ready' ? await findExistingMatches(jira, store, storyKey, parent.target) : [],
  };
}

// El tope de tamaño lo aplica el almacén al leer; aquí solo se aclara que no se sube
async function readUpload(store: StoryStore, file: string, maxBytes: number): Promise<Buffer> {
  try {
    return await readAttachment(store, file, maxBytes);
  } catch (err: unknown) {
    throw new Error(`${(err as Error).message} No lo subo.`);
  }
}

type RemoteFiles = Map<string, Array<{ id: string; filename: string; size: number }>>;

async function uploadTaskAttachments(
  jira: CreateJira,
  store: StoryStore,
  storyKey: string,
  task: PlannedTask,
  issueKey: string,
  maxBytes: number,
  remote: RemoteFiles,
  report: (step: 'uploading' | 'uploaded', detail: string) => void,
): Promise<void> {
  const state = await readState(store, storyKey);
  const entries = (state?.attachments ?? []).filter((e) => hasUploadPurpose(e) && isAssigned(e, task));
  // Con almacén local el tamaño llega en el listado: si ya está en Jira no hace falta leer el archivo
  const sizes = new Map((entries.length > 0 ? await listLocalEntries(store) : []).map((e) => [e.name, e.size]));
  const record = (file: string, id: string) =>
    updateState(store, storyKey, (s) => {
      const target = s.attachments.find((a) => a.file === file);
      if (target) target.uploaded[issueKey] = id;
    });
  for (const entry of entries) {
    if (entry.uploaded[issueKey]) continue;
    let data: Buffer | null = null;
    let size = sizes.get(entry.file);
    if (size === undefined) {
      data = await readUpload(store, entry.file, maxBytes);
      size = data.length;
    }
    // Si un corte dejó el archivo en Jira sin anotarlo, se anota en vez de subirlo otra vez
    if (!remote.has(issueKey)) remote.set(issueKey, await jira.getAttachments(issueKey));
    const already = remote.get(issueKey)?.find((r) => r.filename === entry.file && r.size === size);
    if (already) {
      await record(entry.file, already.id);
      continue;
    }
    report('uploading', entry.file);
    data ??= await readUpload(store, entry.file, maxBytes);
    const id = await jira.uploadAttachment(issueKey, entry.file, data, maxBytes);
    await record(entry.file, id);
    report('uploaded', entry.file);
  }
}

export interface CreationDeps {
  jira: CreateJira;
  store: StoryStore;
  maxUploadBytes?: number;
  // Hoy (AAAA-MM-DD) para recomendar fechas; inyectable en pruebas
  today?: string;
}

// Cada tarea queda anotada en estado.json apenas se crea: un reintento continúa donde se cortó
export async function runCreation(
  deps: CreationDeps,
  storyKey: string,
  request: CreateRequest,
  onProgress: (progress: CreateProgress) => void = () => undefined,
): Promise<CreateOutcome> {
  const { jira, store, maxUploadBytes = MAX_ATTACHMENT_BYTES } = deps;
  const { target, assigneeId, adopt } = request;
  const created: CreatedTask[] = [];
  const remote: RemoteFiles = new Map();
  let estimateSkipped = false;
  try {
    assertKey(storyKey);
    assertKey(target.parentKey);
    for (const key of Object.values(adopt)) assertKey(key);
    const plan = await loadPlan(store);
    const tasks = plan.tasks.filter((t) => t.include);
    const schedule = scheduleOf(plan, deps.today ?? todayIso());
    if (!tasks.length)
      return {
        ok: false,
        message: 'No hay tareas marcadas para crear.',
        created,
      };
    await advancePhase(store, storyKey, 'reviewed');

    for (const [position, task] of tasks.entries()) {
      const report = (step: CreateProgress['step'], detail?: string) =>
        onProgress({
          index: position + 1,
          total: tasks.length,
          summary: task.summary,
          step,
          detail,
        });
      let key = (await readState(store, storyKey))?.createdIssues[task.id] ?? adopt[task.id];
      const existing = Boolean(key);
      if (!key) {
        report('creating');
        const result = await jira.createIssue({
          projectKey: projectKeyOfStory(target.parentKey),
          summary: oneLine(task.summary),
          issueTypeName: target.issueTypeName,
          issueTypeId: target.issueTypeId,
          assigneeId,
          estimateSeconds: effectiveSeconds(task),
          dueDate: schedule.get(task.id)?.dueDate,
          parentKey: target.parentKey,
          description: markdownToAdf(buildDescriptionMarkdown(task)),
        });
        key = result.key;
        estimateSkipped ||= Boolean(result.estimateSkipped);
      }
      const issueKey = key;
      await updateState(store, storyKey, (s) => {
        s.createdIssues[task.id] = issueKey;
      });
      created.push({
        taskId: task.id,
        key: issueKey,
        summary: task.summary,
        existing,
      });
      report(existing ? 'existing' : 'created', issueKey);
      await uploadTaskAttachments(jira, store, storyKey, task, issueKey, maxUploadBytes, remote, report);
    }

    await advancePhase(store, storyKey, 'created');
    return { ok: true, created, parentKey: target.parentKey, estimateSkipped };
  } catch (err: unknown) {
    return { ok: false, message: (err as Error).message, created };
  }
}
