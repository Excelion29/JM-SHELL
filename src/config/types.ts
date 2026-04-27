export interface GlobalConfig {
  jiraUrl: string;
  email: string;
  apiToken: string;
}

export interface ProjectConfig {
  projectKey: string;
  defaultAssignee: string;
}

export interface JiraContext {
  issueKey: string;
  summary?: string;
  issueType?: string;
  parentKey?: string;
  parentSummary?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string; accountId: string } | null;
    duedate: string | null;
    timeoriginalestimate: number | null;
    issuetype: { name: string; iconUrl?: string };
    parent?: { key: string; fields: { summary: string; issuetype?: { name: string } } };
    subtasks?: Array<{ key: string; fields: { summary: string; status: { name: string } } }>;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
}
