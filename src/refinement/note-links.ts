// Enlaces entre las notas de una historia en la base, para que el grafo de Obsidian muestre sus relaciones.
// Todo lo hace jm sin IA: la historia en el centro, con sus tareas, su bitácora y la copia de Jira alrededor.
import { assertKey, escapeCell, isValidIssueKey, LOG_FILE, STORY_FILE } from './state';
import type { StoryStore } from './story-store';
import type { RefinementPlan, StoryState, TaskRun } from './types';

export const TASK_NOTES_DIR = 'tareas';
// Sube cuando cambie la forma de las notas: las historias con un valor menor se reparan una vez al abrirlas
export const NOTES_VERSION = 1;

const SECTION_START = '<!-- jm:tareas · lo mantiene jm, no lo edites -->';
const SECTION_END = '<!-- /jm:tareas -->';
const SECTION_TITLE = '## Tareas en Jira';
const NOTE_EXTENSION = '.md';
const FRONTMATTER_FENCE = '---';
const PLANNING_LABEL = 'Planificación';
const STATUS_LABELS: Record<TaskRun['status'], string> = { started: 'en curso', done: 'terminada' };

export const wikiLink = (key: string): string => {
  assertKey(key);
  return `[[${key}]]`;
};

export const storyLinkLine = (storyKey: string): string => `Historia: ${wikiLink(storyKey)}`;

// Claves de las tareas que ya tienen nota en tareas/ (solo esas se enlazan: un enlace roto crearía una nota suelta)
export async function taskNoteKeys(store: StoryStore): Promise<Set<string>> {
  const entries = await store.list(TASK_NOTES_DIR);
  return new Set(
    entries
      .filter((e) => e.isFile && e.name.endsWith(NOTE_EXTENSION))
      .map((e) => e.name.slice(0, -NOTE_EXTENSION.length))
      .filter(isValidIssueKey),
  );
}

const taskRef = (key: string, withNote: ReadonlySet<string>): string => (withNote.has(key) ? wikiLink(key) : key);

export const taskRefs = (state: StoryState, withNote: ReadonlySet<string>): string[] =>
  Object.values(state.createdIssues).map((key) => taskRef(key, withNote));

function taskLine(
  state: StoryState,
  plan: RefinementPlan | null,
  taskId: string,
  key: string,
  withNote: ReadonlySet<string>,
): string {
  const title = plan?.tasks.find((task) => task.id === taskId)?.summary;
  const run = state.taskRuns[key];
  const parts = [taskRef(key, withNote), title ? escapeCell(title) : null, run ? STATUS_LABELS[run.status] : null];
  return `- ${parts.filter(Boolean).join(' · ')}`;
}

export function renderTasksSection(
  state: StoryState,
  plan: RefinementPlan | null,
  withNote: ReadonlySet<string>,
): string {
  const lines = Object.entries(state.createdIssues).map(([taskId, key]) =>
    taskLine(state, plan, taskId, key, withNote),
  );
  // Las Planificaciones no están en el plan: se listan con su propio nombre
  for (const { issueKey } of state.planningTasks ?? []) {
    const run = state.taskRuns[issueKey];
    const parts = [taskRef(issueKey, withNote), PLANNING_LABEL, run ? STATUS_LABELS[run.status] : null];
    lines.push(`- ${parts.filter(Boolean).join(' · ')}`);
  }
  return [SECTION_START, SECTION_TITLE, '', ...(lines.length ? lines : ['_Sin tareas creadas._']), SECTION_END].join(
    '\n',
  );
}

// Las notas pueden venir con CRLF: se trabaja con \n y se devuelve con el fin de línea original
function keepingEol(text: string, change: (lf: string) => string): string {
  const crlf = text.includes('\r\n');
  const next = change(crlf ? text.replace(/\r\n/g, '\n') : text);
  return crlf ? next.replace(/\n/g, '\r\n') : next;
}

// Reemplaza la sección de jm o la agrega al final; el resto de la nota (lo que escribe Claude) no se toca.
// Con marcadores incompletos o desordenados (editados a mano) no se toca nada: borrar de más sería peor que no actualizar
export function upsertTasksSection(note: string, section: string): string {
  const start = note.indexOf(SECTION_START);
  if (start < 0) return note.includes(SECTION_END) ? note : `${note.replace(/\s*$/, '')}\n\n${section}\n`;
  const end = note.indexOf(SECTION_END, start + SECTION_START.length);
  const consistent =
    end >= 0 &&
    note.indexOf(SECTION_START, start + SECTION_START.length) < 0 &&
    note.lastIndexOf(SECTION_END) === end &&
    note.indexOf(SECTION_END) === end;
  if (!consistent) return note;
  return note.slice(0, start) + section + note.slice(end + SECTION_END.length);
}

// Cambia (o agrega) un campo de la ficha YAML; un valor en varias líneas (lista con guiones) se reemplaza entero
export function setFrontmatterField(note: string, field: string, value: string): string {
  const lines = note.split('\n');
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return note;
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === FRONTMATTER_FENCE);
  if (close < 0) return note;
  const at = lines.findIndex((line, i) => i > 0 && i < close && line.startsWith(`${field}:`));
  const entry = `${field}: ${value}`;
  if (at < 0) {
    lines.splice(close, 0, entry);
    return lines.join('\n');
  }
  let next = at + 1;
  while (next < close && /^\s+-/.test(lines[next])) next += 1;
  lines.splice(at, next - at, entry);
  return lines.join('\n');
}

// Nota de la historia (<CLAVE>.md en JM-ADR): fase, tareas y la sección con un enlace por tarea. Si aún no existe, no se crea
export function linkStoryNote(
  note: string,
  state: StoryState,
  plan: RefinementPlan | null,
  withNote: ReadonlySet<string>,
): string {
  const keys = Object.values(state.createdIssues);
  return keepingEol(note, (text) => {
    const next = setFrontmatterField(setFrontmatterField(text, 'fase', state.phase), 'tareas', `[${keys.join(', ')}]`);
    return upsertTasksSection(next, renderTasksSection(state, plan, withNote));
  });
}

// Agrega "Historia: [[CLAVE]]" bajo el título si la nota aún no enlaza a su historia
export function ensureStoryLink(text: string, storyKey: string): string {
  if (text.includes(wikiLink(storyKey))) return text;
  return keepingEol(text, (lf) => insertStoryLink(lf, storyKey));
}

// Bajo el título; sin título, tras la ficha YAML (ponerlo antes la rompería) o al principio
function insertStoryLink(text: string, storyKey: string): string {
  const lines = text.split('\n');
  const title = lines.findIndex((line) => line.startsWith('# '));
  const plainLine = lines.findIndex((line) => line.trim() === `Historia: ${storyKey}`);
  if (plainLine >= 0) {
    lines[plainLine] = storyLinkLine(storyKey);
    return lines.join('\n');
  }
  if (title >= 0) {
    lines.splice(title + 1, 0, '', storyLinkLine(storyKey));
    return lines.join('\n');
  }
  const close =
    lines[0]?.trim() === FRONTMATTER_FENCE ? lines.findIndex((l, i) => i > 0 && l.trim() === FRONTMATTER_FENCE) : -1;
  lines.splice(close + 1, 0, storyLinkLine(storyKey), '');
  return lines.join('\n');
}

export const taskNoteFrontmatter = (storyKey: string, issueKey: string): string =>
  [FRONTMATTER_FENCE, `historia: ${storyKey}`, `tarea: ${issueKey}`, 'tags: [tipo/tarea]', FRONTMATTER_FENCE, ''].join(
    '\n',
  );

// Líneas de una sección "## Título" hasta la siguiente de su nivel; null si no está
function sectionBounds(lines: string[], heading: string): [number, number] | null {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
  return [start, end];
}

function removeSection(text: string, heading: string): string {
  const lines = text.split('\n');
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return text;
  lines.splice(bounds[0], bounds[1] - bounds[0]);
  return lines.join('\n');
}

function sectionText(text: string, heading: string): string {
  const lines = text.split('\n');
  const bounds = sectionBounds(lines, heading);
  return bounds ? lines.slice(bounds[0], bounds[1]).join('\n') : '';
}

const NOTE_HINT_HEADING = '## Nota de la historia';
const CRITERIA_HEADING = '## Criterio de terminado';
const DESCRIPTION_HEADING = '## Descripción';
const CRITERIA_TEXT = /criterio de terminado/i;
const PREVIOUS_TASK_LINE = /^- ([A-Z][A-Z0-9_]+-\d+) · (.*) \(su detalle está en tareas\/\1\.md\)$/gm;

// Nota de tarea escrita por versiones anteriores: ficha, enlace a la historia, sin la instrucción técnica ni el criterio repetido
export function repairTaskNote(text: string, storyKey: string, issueKey: string): string {
  return keepingEol(text, (lf) => repairTaskNoteLf(lf, storyKey, issueKey));
}

function repairTaskNoteLf(text: string, storyKey: string, issueKey: string): string {
  let next = removeSection(text, NOTE_HINT_HEADING);
  // Solo se quita la sección suelta si la descripción de Jira ya trae el criterio
  if (CRITERIA_TEXT.test(sectionText(next, DESCRIPTION_HEADING))) next = removeSection(next, CRITERIA_HEADING);
  next = ensureStoryLink(next, storyKey);
  // Las tareas anteriores pasan de ruta en texto a enlace
  next = next.replace(PREVIOUS_TASK_LINE, (_line, key: string, title: string) => `- [[${key}]] · ${title}`);
  if (!next.startsWith(FRONTMATTER_FENCE)) next = taskNoteFrontmatter(storyKey, issueKey) + next;
  return next;
}

async function rewriteIfChanged(store: StoryStore, name: string, change: (text: string) => string): Promise<void> {
  const text = await store.readText(name);
  if (text === null) return;
  const next = change(text);
  if (next !== text) await store.writeText(name, next);
}

// Una sola vez por historia (NOTES_VERSION): repara las notas que dejaron versiones anteriores de jm
export async function repairStoryNotes(store: StoryStore, storyKey: string): Promise<void> {
  for (const key of await taskNoteKeys(store)) {
    await rewriteIfChanged(store, `${TASK_NOTES_DIR}/${key}${NOTE_EXTENSION}`, (text) =>
      repairTaskNote(text, storyKey, key),
    );
  }
  for (const name of [STORY_FILE, LOG_FILE])
    await rewriteIfChanged(store, name, (text) => ensureStoryLink(text, storyKey));
}
