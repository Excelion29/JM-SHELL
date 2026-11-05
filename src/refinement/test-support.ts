import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { JiraIssue } from '../config/types';
import { IssueNotFoundError } from '../services/jira';
import type { CloseJira } from './close';
import type { CreateJira } from './create';
import { safeWriteFile } from './safe-fs';
import { attachmentsDir, ensureStory, planPath, updateState } from './state';
import type { Phase, PlannedTask, StoryAttachment } from './types';

export async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jm-flow-'));
}

export const task = (id: string, patch: Partial<PlannedTask> = {}): PlannedTask => ({
  id,
  summary: `Tarea ${id}`,
  description: `Detalle de ${id}`,
  doneCriteria: ['Pasa el test', 'Sin errores'],
  estimate: { optimistic: '30m', likely: '1h', pessimistic: '2h' },
  risk: 'medium',
  rationale: 'Parecido a AQ-10',
  include: true,
  attachments: [],
  ...patch,
});

export interface SeedOptions {
  phase?: Phase;
  files?: Record<string, string>;
  attachments?: StoryAttachment[];
}

export async function seedStory(
  root: string,
  key: string,
  tasks: PlannedTask[],
  options: SeedOptions = {},
): Promise<void> {
  await ensureStory(root, key, 'Historia de prueba', null);
  safeWriteFile(root, planPath(root, key), `${JSON.stringify({ storyKey: key, tasks }, null, 2)}\n`);
  for (const [name, content] of Object.entries(options.files ?? {})) {
    await fs.writeFile(path.join(attachmentsDir(root, key), name), content);
  }
  await updateState(root, key, (s) => {
    s.phase = options.phase ?? 'plan';
    s.attachments = options.attachments ?? [];
  });
}

export const attachment = (file: string, patch: Partial<StoryAttachment> = {}): StoryAttachment => ({
  file,
  purpose: 'analysis',
  origin: 'local',
  taskIds: [],
  uploaded: {},
  ...patch,
});

const DONE_CATEGORY = 'done';

export interface FakeIssueSpec {
  type?: string;
  status?: 'open' | 'done';
  epic?: { key: string; summary: string };
}

export interface FakeJiraOptions {
  issues?: Record<string, FakeIssueSpec>;
  children?: Array<{ key: string; summary: string }>;
  remote?: Record<string, Array<{ filename: string; size: number }>>;
  // La n-ésima creación (desde 1) falla
  failCreateAt?: number;
  failUploads?: boolean;
}

const TYPES = [
  { id: '1', name: 'Epic', subtask: false },
  { id: '2', name: 'Historia', subtask: false },
  { id: '3', name: 'Tarea', subtask: false },
  { id: '4', name: 'Subtarea', subtask: true },
];

export function createFakeJira(options: FakeJiraOptions = {}) {
  const calls = {
    created: [] as Array<Record<string, unknown>>,
    uploads: [] as Array<{ issueKey: string; file: string }>,
    getAttachments: [] as string[],
    searches: [] as string[],
  };
  let counter = 100;
  const issue = (key: string): JiraIssue => {
    const spec = options.issues?.[key];
    if (!spec) throw new IssueNotFoundError(`Resource not found: ${key}`);
    return {
      id: key,
      key,
      fields: {
        summary: `Resumen de ${key}`,
        status: {
          name: spec.status === 'done' ? 'Listo' : 'En curso',
          statusCategory: { key: spec.status === 'done' ? DONE_CATEGORY : 'indeterminate' },
        },
        assignee: null,
        duedate: null,
        timeoriginalestimate: null,
        issuetype: { name: spec.type ?? 'Historia' },
        subtasks: (options.children ?? []).map((c) => ({ key: c.key, fields: { summary: c.summary, status: { name: 'Por hacer' } } })),
        parent: spec.epic
          ? { key: spec.epic.key, fields: { summary: spec.epic.summary, issuetype: { name: 'Epic' } } }
          : undefined,
      },
    };
  };
  const jira: CreateJira & CloseJira = {
    getIssue: async (key) => issue(key),
    getIssueTypes: async () => TYPES,
    searchAllIssues: async (jql) => (calls.searches.push(jql), 
      (options.children ?? []).map((c) => ({
        id: c.key,
        key: c.key,
        fields: { summary: c.summary, status: { name: 'Por hacer' }, assignee: null, duedate: null, timeoriginalestimate: null, issuetype: { name: 'Subtarea' } },
      }))),
    createIssue: async (params) => {
      if (options.failCreateAt === calls.created.length + 1) throw new Error('Jira API error (500): caído');
      calls.created.push(params as unknown as Record<string, unknown>);
      counter += 1;
      return { key: `AQ-${counter}` };
    },
    uploadAttachment: async (issueKey, file) => {
      if (options.failUploads) throw new Error('Jira API error (413): demasiado grande');
      calls.uploads.push({ issueKey, file: path.basename(file) });
      return `att-${calls.uploads.length}`;
    },
    getAttachments: async (issueKey) => {
      calls.getAttachments.push(issueKey);
      return (options.remote?.[issueKey] ?? []).map((r, i) => ({ id: String(i), content: '', ...r }));
    },
  };
  return { jira, calls };
}
