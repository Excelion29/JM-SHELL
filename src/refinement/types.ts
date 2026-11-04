export const PHASES = ['spec', 'debate', 'plan', 'reviewed', 'created', 'in-progress', 'closed'] as const;
export type Phase = (typeof PHASES)[number];

export const BLOCKS = ['scope', 'dependencies', 'risks', 'done-criteria', 'tasks', 'estimation'] as const;
export type Block = (typeof BLOCKS)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

export const ATTACHMENT_PURPOSES = ['analysis', 'evidence', 'team'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

export type AttachmentOrigin = 'jira' | 'local';

export interface TaskEstimate {
  optimistic: string;
  likely: string;
  pessimistic: string;
}

export interface PlannedTask {
  id: string;
  summary: string;
  description: string;
  doneCriteria: string[];
  estimate: TaskEstimate;
  risk: Risk;
  rationale: string;
  include: boolean;
  attachments: string[];
}

export interface RefinementPlan {
  storyKey: string;
  tasks: PlannedTask[];
}

export interface StoryAttachment {
  file: string;
  purpose: AttachmentPurpose;
  origin: AttachmentOrigin;
  taskIds: string[];
  uploaded: Record<string, string>;
}

export interface StoryUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  turns: number;
}

export interface StoryState {
  key: string;
  summary: string;
  phase: Phase;
  block: Block | null;
  claudeSessionId: string | null;
  parentKey: string | null;
  createdIssues: Record<string, string>;
  attachments: StoryAttachment[];
  usage: StoryUsage;
  updatedAt: string;
}

export interface StorySummary {
  key: string;
  summary: string;
  phase: string;
  block: string;
  nextStep: string;
  updatedAt: string;
}

export interface BrowseItem {
  key: string;
  summary: string;
  status: string;
}

export interface ProjectItem {
  key: string;
  name: string;
}
