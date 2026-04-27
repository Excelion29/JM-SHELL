import axios, { AxiosInstance, AxiosError } from 'axios';
import { GlobalConfig, JiraIssue, JiraTransition, JiraUser } from '../config/types';

export class TransitionNotFoundError extends Error {
  constructor(public attempted: string, public available: string[]) {
    super(`Transición "${attempted}" no encontrada.`);
  }
}

export class JiraService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(config: GlobalConfig) {
    this.baseUrl = config.jiraUrl.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: `${this.baseUrl}/rest/api/3`,
      auth: {
        username: config.email,
        password: config.apiToken,
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (res) => res,
      (err: AxiosError) => {
        const status = err.response?.status;
        const data = err.response?.data as Record<string, unknown> | undefined;
        const messages = (data?.errorMessages as string[]) ?? [];
        const errors = data?.errors as Record<string, string> | undefined;
        const detail = [
          ...messages,
          ...Object.values(errors ?? {}),
        ].join('; ') || err.message;

        if (status === 401) throw new Error('Authentication failed. Check your email and API token.');
        if (status === 403) throw new Error(`Permission denied: ${detail}`);
        if (status === 404) throw new Error(`Resource not found: ${detail}`);
        throw new Error(`Jira API error (${status}): ${detail}`);
      }
    );
  }

  getBrowseUrl(issueKey: string): string {
    return `${this.baseUrl}/browse/${issueKey}`;
  }

  async getMyself(): Promise<JiraUser> {
    const res = await this.client.get<JiraUser>('/myself');
    return res.data;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this.client.get<JiraIssue>(`/issue/${issueKey}`, {
      params: {
        fields: 'summary,status,assignee,duedate,timeoriginalestimate,issuetype,parent,subtasks',
      },
    });
    return res.data;
  }

  async createIssue(params: {
    projectKey: string;
    summary: string;
    issueTypeName: string;
    assigneeId: string;
    estimateSeconds?: number;
    dueDate?: string;
    parentKey?: string;
  }): Promise<{ key: string; estimateSkipped?: boolean }> {
    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      summary: params.summary,
      issuetype: { name: params.issueTypeName },
      assignee: { accountId: params.assigneeId },
    };

    if (params.dueDate) fields.duedate = params.dueDate;
    if (params.estimateSeconds) {
      // Jira Cloud prefiere timetracking con texto ("1h 30m") sobre timeoriginalestimate en segundos
      const h = Math.floor(params.estimateSeconds / 3600);
      const m = Math.floor((params.estimateSeconds % 3600) / 60);
      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      const estimate = parts.join(' ') || '0m';
      fields.timetracking = { originalEstimate: estimate, remainingEstimate: estimate };
    }
    if (params.parentKey) fields.parent = { key: params.parentKey };

    try {
      const res = await this.client.post<{ id: string; key: string }>('/issue', { fields });
      return { key: res.data.key };
    } catch (err: unknown) {
      // Si el error es por timetracking no habilitado, reintentar sin estimación
      const msg = (err as Error).message ?? '';
      if (msg.includes('timetracking') || msg.includes('timeoriginalestimate')) {
        delete fields.timetracking;
        const res = await this.client.post<{ id: string; key: string }>('/issue', { fields });
        return { key: res.data.key, estimateSkipped: true };
      }
      throw err;
    }
  }

  async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.client.put(`/issue/${issueKey}`, { fields });
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const res = await this.client.get<{ transitions: JiraTransition[] }>(`/issue/${issueKey}/transitions`);
    return res.data.transitions;
  }

  async doTransition(issueKey: string, transitionId: string): Promise<void> {
    await this.client.post(`/issue/${issueKey}/transitions`, {
      transition: { id: transitionId },
    });
  }

  async transitionToStatus(issueKey: string, statusName: string): Promise<string> {
    const transitions = await this.getTransitions(issueKey);
    const needle = statusName.toLowerCase();
    // Match exacto primero, luego parcial
    const match =
      transitions.find((t) => t.name.toLowerCase() === needle) ??
      transitions.find((t) => t.name.toLowerCase().includes(needle));
    if (!match) {
      const available = transitions.map((t) => t.name);
      throw new TransitionNotFoundError(statusName, available);
    }
    await this.doTransition(issueKey, match.id);
    return match.name;
  }

  async searchIssues(jql: string, fields: string[] = ['summary', 'status', 'assignee', 'issuetype', 'parent']): Promise<JiraIssue[]> {
    const res = await this.client.post<{ issues: JiraIssue[] }>('/search/jql', {
      jql,
      fields,
      maxResults: 100,
    });
    return res.data.issues;
  }

  async reparent(issueKey: string, newParentKey: string): Promise<void> {
    await this.client.put(`/issue/${issueKey}`, {
      fields: { parent: { key: newParentKey } },
    });
  }

  async getIssueTypes(projectKey: string): Promise<Array<{ id: string; name: string; subtask: boolean }>> {
    const res = await this.client.get<{ issueTypes: Array<{ id: string; name: string; subtask: boolean }> }>(
      `/project/${projectKey}`
    );
    return (res.data as unknown as { issueTypes: Array<{ id: string; name: string; subtask: boolean }> }).issueTypes ?? [];
  }

  async getProjects(): Promise<Array<{ key: string; name: string; projectTypeKey: string }>> {
    const res = await this.client.get<{ values: Array<{ key: string; name: string; projectTypeKey: string }> }>(
      '/project/search',
      { params: { maxResults: 100, orderBy: 'name' } }
    );
    return res.data.values;
  }
}
