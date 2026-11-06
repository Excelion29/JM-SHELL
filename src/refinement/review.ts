import * as path from 'path';
import { MAX_ATTACHMENT_BYTES, sanitizeFilename } from './attachments';
import { parsePlan, validatePlan } from './plan';
import {
  effectiveSeconds,
  expectedSeconds,
  parseEstimate,
  parseFinalEstimate,
  planTotals,
  recommendedSeconds,
  stdDevSeconds,
} from './pert';
import { DAILY_CAPACITY_SECONDS, daySeconds, parseDueDateInput, scheduleOf, todayIso } from './schedule';
import type { EstimatePreview, ReviewFile, ReviewModel, TaskPatch } from './review-types';
import { ATTACHMENTS_DIR, PLAN_FILE, readState, updateState } from './state';
import type { StoreEntry, StoryStore } from './story-store';
import { WORK_OPEN_DIR, writeReadOnlyCopy } from './workdir';
import { ATTACHMENT_PURPOSES, AttachmentPurpose, PlannedTask, RefinementPlan, StoryState, TaskEstimate } from './types';

const REVIEWABLE_PHASES: readonly string[] = ['plan', 'reviewed'];
const TEMP_FILE_SUFFIX = /\.(part|tmp)$/;

export function previewEstimate(estimate: TaskEstimate): EstimatePreview {
  try {
    const { optimistic, likely, pessimistic } = parseEstimate(estimate);
    return {
      ok: true,
      expectedSeconds: Math.round(expectedSeconds(optimistic, likely, pessimistic)),
      stdDevSeconds: Math.round(stdDevSeconds(optimistic, pessimistic)),
    };
  } catch (err: unknown) {
    return { ok: false, message: (err as Error).message };
  }
}

async function requireState(store: StoryStore, key: string): Promise<StoryState> {
  const state = await readState(store, key);
  if (!state) throw new Error(`La historia ${key} aún no tiene estado. Ejecuta \`jm refinar ${key}\`.`);
  return state;
}

async function readPlan(store: StoryStore, key: string): Promise<RefinementPlan> {
  const text = await store.readText(PLAN_FILE);
  if (text === null) throw new Error(`La historia ${key} aún no tiene plan.json.`);
  return parsePlan(text, `${store.label}/${PLAN_FILE}`);
}

// Escritura atómica en el almacén: un corte a medias nunca deja un plan.json cortado
async function writePlan(store: StoryStore, plan: RefinementPlan): Promise<void> {
  validatePlan(plan);
  await store.writeText(PLAN_FILE, `${JSON.stringify(plan, null, 2)}\n`);
}

function assertReviewable(state: StoryState): void {
  if (!REVIEWABLE_PHASES.includes(state.phase)) {
    throw new Error(`El plan de ${state.key} ya no se puede revisar (fase "${state.phase}").`);
  }
}

// Primer guardado de la revisión: plan -> revisado
function markReviewed(state: StoryState): void {
  if (state.phase === 'plan') state.phase = 'reviewed';
}

// Solo archivos regulares con nombre que el estado acepte: lo demás no se puede asignar
export async function listLocalEntries(store: StoryStore): Promise<StoreEntry[]> {
  const entries = await store.list(ATTACHMENTS_DIR);
  return entries
    .filter(
      (entry) =>
        entry.isFile &&
        entry.name === sanitizeFilename(entry.name) &&
        !entry.name.includes(':') &&
        !TEMP_FILE_SUFFIX.test(entry.name),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function listLocalFiles(store: StoryStore): Promise<string[]> {
  return (await listLocalEntries(store)).map((entry) => entry.name);
}

// Los adjuntos vienen de Jira: abrir un .bat/.exe/.lnk con la app por defecto los ejecutaría en Windows
export const SAFE_OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.txt',
  '.md',
  '.csv',
  '.log',
  '.json',
  '.xlsx',
  '.docx',
]);

export function assertSafeToOpen(file: string): void {
  if (!SAFE_OPEN_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    throw new Error(
      `No abro ${file} desde la app por seguridad; ábrelo a mano desde la carpeta de adjuntos de la historia.`,
    );
  }
}

// Nombre de un adjunto dentro de la historia: una sola pieza, sin subcarpetas
export function attachmentStoreName(file: string): string {
  if (file !== sanitizeFilename(file) || file.includes(':')) throw new Error(`El adjunto "${file}" no es válido.`);
  return `${ATTACHMENTS_DIR}/${file}`;
}

export async function readAttachment(
  store: StoryStore,
  file: string,
  maxBytes: number = MAX_ATTACHMENT_BYTES,
): Promise<Buffer> {
  const data = await store.readBinary(attachmentStoreName(file), maxBytes);
  if (!data) throw new Error(`No encontré el adjunto ${file} en la carpeta de la historia.`);
  return data;
}

// Ruta en disco para abrirlo con la app por defecto: la real si es local; si vive en la bóveda, una copia temporal
export async function attachmentFilePath(
  store: StoryStore,
  key: string,
  file: string,
  workDir: string,
): Promise<string> {
  const name = attachmentStoreName(file);
  const local = store.localPath(name);
  if (local) {
    if (!(await store.exists(name))) throw new Error(`No encontré el adjunto ${file} en la carpeta de la historia.`);
    return local;
  }
  return writeReadOnlyCopy(workDir, path.join(WORK_OPEN_DIR, key), file, await readAttachment(store, file));
}

function buildReview(
  key: string,
  state: StoryState,
  plan: RefinementPlan,
  localFiles: string[],
  today: string,
): ReviewModel {
  const pendingPlan: RefinementPlan = {
    ...plan,
    tasks: plan.tasks.filter((t) => !state.createdIssues[t.id]),
  };
  const schedule = scheduleOf(pendingPlan, today);
  const files: ReviewFile[] = localFiles.map((file) => {
    const entry = state.attachments.find((a) => a.file === file);
    const planned = plan.tasks.filter((t) => t.attachments.includes(file)).map((t) => t.id);
    return {
      file,
      purpose: entry?.purpose ?? 'analysis',
      taskIds: [...new Set([...(entry?.taskIds ?? []), ...planned])],
    };
  });
  return {
    storyKey: key,
    summary: state.summary,
    phase: state.phase,
    tasks: plan.tasks.map((task) => {
      const { optimistic, likely, pessimistic } = parseEstimate(task.estimate);
      const entry = schedule.get(task.id);
      return {
        ...task,
        expectedSeconds: Math.round(expectedSeconds(optimistic, likely, pessimistic)),
        stdDevSeconds: Math.round(stdDevSeconds(optimistic, pessimistic)),
        recommendedSeconds: recommendedSeconds(task),
        effectiveSeconds: effectiveSeconds(task),
        recommendedDate: entry?.recommended ?? null,
        effectiveDate: entry?.dueDate ?? null,
        dateManual: entry?.manual ?? false,
        jiraKey: state.createdIssues[task.id] ?? null,
      };
    }),
    files,
    totals: planTotals(pendingPlan),
    createdCount: plan.tasks.filter((t) => state.createdIssues[t.id]).length,
    daySeconds: daySeconds(pendingPlan, schedule),
    dailyCapacitySeconds: DAILY_CAPACITY_SECONDS,
  };
}

export async function loadReview(store: StoryStore, key: string, today: string = todayIso()): Promise<ReviewModel> {
  const state = await requireState(store, key);
  const plan = await readPlan(store, key);
  return buildReview(key, state, plan, await listLocalFiles(store), today);
}

function applyFinalEstimate(task: PlannedTask, value: string | null): void {
  const text = value?.trim() ?? '';
  if (!text) {
    delete task.finalEstimate;
    return;
  }
  parseFinalEstimate(text);
  task.finalEstimate = text;
}

function applyDueDate(task: PlannedTask, value: string | null, today: string): void {
  const text = value?.trim() ?? '';
  if (!text) {
    delete task.dueDate;
    delete task.dueDateManual;
    return;
  }
  task.dueDate = parseDueDateInput(text, today);
  task.dueDateManual = true;
}

export async function updateTask(
  store: StoryStore,
  key: string,
  taskId: string,
  patch: TaskPatch,
  today: string = todayIso(),
): Promise<ReviewModel> {
  const before = await requireState(store, key);
  assertReviewable(before);
  const plan = await readPlan(store, key);
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No encontré la tarea ${taskId} en el plan.`);
  if (before.createdIssues[taskId]) {
    throw new Error(`La tarea ${taskId} ya se creó en Jira (${before.createdIssues[taskId]}); no se puede cambiar aquí.`);
  }
  if (patch.summary !== undefined) {
    if (!patch.summary.trim()) throw new Error('El título no puede quedar vacío.');
    task.summary = patch.summary.trim();
  }
  if (patch.estimate) {
    const estimate = {
      optimistic: patch.estimate.optimistic.trim(),
      likely: patch.estimate.likely.trim(),
      pessimistic: patch.estimate.pessimistic.trim(),
    };
    parseEstimate(estimate);
    task.estimate = estimate;
  }
  if (patch.include !== undefined) task.include = patch.include;
  if (patch.finalEstimate !== undefined) applyFinalEstimate(task, patch.finalEstimate);
  if (patch.dueDate !== undefined) applyDueDate(task, patch.dueDate, today);
  await writePlan(store, plan);
  const state = await updateState(store, key, markReviewed);
  return buildReview(key, state, plan, await listLocalFiles(store), today);
}

async function requireLocalFile(store: StoryStore, file: string): Promise<string[]> {
  const localFiles = await listLocalFiles(store);
  if (!localFiles.includes(file)) throw new Error(`El adjunto ${file} no está en la carpeta de la historia.`);
  return localFiles;
}

export async function setAttachmentPurpose(
  store: StoryStore,
  key: string,
  file: string,
  purpose: AttachmentPurpose,
): Promise<ReviewModel> {
  assertReviewable(await requireState(store, key));
  if (!ATTACHMENT_PURPOSES.includes(purpose)) throw new Error(`Propósito desconocido: ${purpose}.`);
  const localFiles = await requireLocalFile(store, file);
  const state = await updateState(store, key, (s) => {
    const entry = s.attachments.find((a) => a.file === file);
    if (entry) entry.purpose = purpose;
    else s.attachments.push({ file, purpose, origin: 'local', taskIds: [], uploaded: {} });
    markReviewed(s);
  });
  return buildReview(key, state, await readPlan(store, key), localFiles, todayIso());
}

// La asignación vive en estado.json (taskIds) y se refleja en plan.json (attachments) para que ambos coincidan
export async function toggleAttachmentTask(
  store: StoryStore,
  key: string,
  file: string,
  taskId: string,
): Promise<ReviewModel> {
  const before = await requireState(store, key);
  assertReviewable(before);
  const localFiles = await requireLocalFile(store, file);
  const plan = await readPlan(store, key);
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No encontré la tarea ${taskId} en el plan.`);
  const assigned =
    (before.attachments.find((a) => a.file === file)?.taskIds.includes(taskId) ?? false) ||
    task.attachments.includes(file);

  task.attachments = assigned ? task.attachments.filter((f) => f !== file) : [...new Set([...task.attachments, file])];
  await writePlan(store, plan);
  const state = await updateState(store, key, (s) => {
    let entry = s.attachments.find((a) => a.file === file);
    if (!entry) {
      entry = { file, purpose: 'analysis', origin: 'local', taskIds: [], uploaded: {} };
      s.attachments.push(entry);
    }
    entry.taskIds = assigned ? entry.taskIds.filter((id) => id !== taskId) : [...new Set([...entry.taskIds, taskId])];
    markReviewed(s);
  });
  return buildReview(key, state, plan, localFiles, todayIso());
}
