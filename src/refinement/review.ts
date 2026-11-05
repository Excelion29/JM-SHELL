import * as fs from 'fs-extra';
import * as path from 'path';
import { resolveInside, sanitizeFilename } from './attachments';
import { loadPlan, validatePlan } from './plan';
import { expectedSeconds, parseEstimate, planTotals, stdDevSeconds } from './pert';
import type { EstimatePreview, ReviewFile, ReviewModel, TaskPatch } from './review-types';
import { assertNoLinks, lexists, safeWriteFile } from './safe-fs';
import { attachmentsDir, planPath, readState, updateState } from './state';
import { ATTACHMENT_PURPOSES, AttachmentPurpose, RefinementPlan, StoryState, TaskEstimate } from './types';

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

async function requireState(root: string, key: string): Promise<StoryState> {
  const state = await readState(root, key);
  if (!state) throw new Error(`La historia ${key} aún no tiene estado. Ejecuta \`jm refinar ${key}\`.`);
  return state;
}

async function readPlan(root: string, key: string): Promise<RefinementPlan> {
  const file = planPath(root, key);
  if (!lexists(file)) throw new Error(`La historia ${key} aún no tiene plan.json.`);
  assertNoLinks(root, file);
  return loadPlan(file);
}

// Escritura atómica (temp + rename): un corte a medias nunca deja un plan.json cortado
function writePlan(root: string, key: string, plan: RefinementPlan): void {
  validatePlan(plan);
  safeWriteFile(root, planPath(root, key), `${JSON.stringify(plan, null, 2)}\n`);
}

function assertReviewable(state: StoryState): void {
  if (!REVIEWABLE_PHASES.includes(state.phase)) {
    throw new Error(`El plan de ${state.key} ya no se puede revisar (fase "${state.phase}").`);
  }
}

// Primer guardado de la revisión: plan -> revisado
async function markReviewed(root: string, key: string): Promise<void> {
  await updateState(root, key, (s) => {
    if (s.phase === 'plan') s.phase = 'reviewed';
  });
}

// Solo archivos regulares con nombre que el estado acepte: lo demás no se puede asignar
export function listLocalFiles(root: string, key: string): string[] {
  const dir = attachmentsDir(root, key);
  if (!lexists(dir)) return [];
  assertNoLinks(root, dir);
  return fs
    .readdirSync(dir)
    .filter((name) => name === sanitizeFilename(name) && !name.includes(':') && !TEMP_FILE_SUFFIX.test(name))
    .filter((name) => {
      const stat = fs.lstatSync(resolveInside(dir, name));
      return stat.isFile() && !stat.isSymbolicLink();
    })
    .sort();
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

// Ruta validada de un adjunto: dentro de adjuntos/, sin enlaces y existente
export function attachmentFilePath(root: string, key: string, file: string): string {
  const dest = resolveInside(attachmentsDir(root, key), file);
  assertNoLinks(root, dest);
  if (!lexists(dest)) throw new Error(`No encontré el adjunto ${file} en la carpeta de la historia.`);
  return dest;
}

export async function loadReview(root: string, key: string): Promise<ReviewModel> {
  const state = await requireState(root, key);
  const plan = await readPlan(root, key);
  const files: ReviewFile[] = listLocalFiles(root, key).map((file) => {
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
      return {
        ...task,
        expectedSeconds: Math.round(expectedSeconds(optimistic, likely, pessimistic)),
        stdDevSeconds: Math.round(stdDevSeconds(optimistic, pessimistic)),
      };
    }),
    files,
    totals: planTotals(plan),
  };
}

export async function updateTask(root: string, key: string, taskId: string, patch: TaskPatch): Promise<ReviewModel> {
  assertReviewable(await requireState(root, key));
  const plan = await readPlan(root, key);
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No encontré la tarea ${taskId} en el plan.`);
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
  writePlan(root, key, plan);
  await markReviewed(root, key);
  return loadReview(root, key);
}

function assertLocalFile(root: string, key: string, file: string): void {
  if (!listLocalFiles(root, key).includes(file))
    throw new Error(`El adjunto ${file} no está en la carpeta de la historia.`);
}

export async function setAttachmentPurpose(
  root: string,
  key: string,
  file: string,
  purpose: AttachmentPurpose,
): Promise<ReviewModel> {
  assertReviewable(await requireState(root, key));
  if (!ATTACHMENT_PURPOSES.includes(purpose)) throw new Error(`Propósito desconocido: ${purpose}.`);
  assertLocalFile(root, key, file);
  await updateState(root, key, (s) => {
    const entry = s.attachments.find((a) => a.file === file);
    if (entry) entry.purpose = purpose;
    else s.attachments.push({ file, purpose, origin: 'local', taskIds: [], uploaded: {} });
  });
  await markReviewed(root, key);
  return loadReview(root, key);
}

// La asignación vive en estado.json (taskIds) y se refleja en plan.json (attachments) para que ambos coincidan
export async function toggleAttachmentTask(
  root: string,
  key: string,
  file: string,
  taskId: string,
): Promise<ReviewModel> {
  assertReviewable(await requireState(root, key));
  assertLocalFile(root, key, file);
  const plan = await readPlan(root, key);
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No encontré la tarea ${taskId} en el plan.`);
  const current = await loadReview(root, key);
  const assigned = current.files.find((f) => f.file === file)?.taskIds.includes(taskId) ?? false;

  task.attachments = assigned ? task.attachments.filter((f) => f !== file) : [...new Set([...task.attachments, file])];
  writePlan(root, key, plan);
  await updateState(root, key, (s) => {
    let entry = s.attachments.find((a) => a.file === file);
    if (!entry) {
      entry = { file, purpose: 'analysis', origin: 'local', taskIds: [], uploaded: {} };
      s.attachments.push(entry);
    }
    entry.taskIds = assigned ? entry.taskIds.filter((id) => id !== taskId) : [...new Set([...entry.taskIds, taskId])];
  });
  await markReviewed(root, key);
  return loadReview(root, key);
}
