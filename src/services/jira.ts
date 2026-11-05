import axios, { AxiosInstance, AxiosError } from 'axios';
import { pathKey, pathProject } from '../refinement/issue-key';
import { assertSameOrigin, MAX_ATTACHMENT_BYTES, streamToFileWithCap } from '../refinement/attachments';
import { GlobalConfig, JiraAttachment, JiraIssue, JiraTransition, JiraUser } from '../config/types';

// Conexión y respuesta de cada paso de una descarga; el cuerpo se corta por tamaño (MAX_ATTACHMENT_BYTES), no por tiempo
const DOWNLOAD_CONNECT_TIMEOUT_MS = 15_000;
const DOWNLOAD_STEPS = {
  content: 'la petición de contenido a Jira',
  signed: 'el redirect firmado',
  body: 'la descarga del cuerpo',
};
const TIMEOUT_ERROR_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const UPLOAD_TIMEOUT_MS = 120_000;
const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 20;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

// Conserva el `code` original para clasificar el fallo sin depender del texto del mensaje
export async function atStep<T>(step: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err: unknown) {
    const cause = err as Error & { code?: string };
    throw Object.assign(new Error(`falló ${step}: ${cause.message}`), { code: cause.code });
  }
}

export function isTimeoutError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TIMEOUT_ERROR_CODES.has(code);
}

export class IssueNotFoundError extends Error {}

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
        if (status === 404) throw new IssueNotFoundError(`Resource not found: ${detail}`);
        throw new Error(`Jira API error (${status}): ${detail}`);
      }
    );
  }

  getBrowseUrl(issueKey: string): string {
    return `${this.baseUrl}/browse/${pathKey(issueKey)}`;
  }

  async getMyself(): Promise<JiraUser> {
    const res = await this.client.get<JiraUser>('/myself');
    return res.data;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this.client.get<JiraIssue>(`/issue/${pathKey(issueKey)}`, {
      params: {
        fields: 'summary,status,assignee,duedate,timeoriginalestimate,issuetype,parent,subtasks',
      },
    });
    return res.data;
  }

  async getIssueWithDescription(issueKey: string): Promise<JiraIssue> {
    const res = await this.client.get<JiraIssue>(`/issue/${pathKey(issueKey)}`, {
      params: {
        fields: 'summary,status,assignee,duedate,timeoriginalestimate,issuetype,parent,subtasks,description',
      },
    });
    return res.data;
  }

  async getAttachments(issueKey: string): Promise<JiraAttachment[]> {
    const res = await this.client.get<{ fields: { attachment?: JiraAttachment[] } }>(`/issue/${pathKey(issueKey)}`, {
      params: { fields: 'attachment' },
    });
    return res.data.fields.attachment ?? [];
  }

  // Jira responde con un redirect firmado (otro origen): se sigue a mano y sin credenciales
  async downloadAttachment(url: string, destPath: string, maxBytes: number = MAX_ATTACHMENT_BYTES): Promise<void> {
    assertSameOrigin(url, this.baseUrl);
    const first = await atStep(DOWNLOAD_STEPS.content, () =>
      this.client.get(url, {
        responseType: 'stream',
        headers: { Accept: '*/*' },
        maxRedirects: 0,
        timeout: DOWNLOAD_CONNECT_TIMEOUT_MS,
        validateStatus: (status) => status < 400,
      }),
    );
    const location = first.headers['location'] as string | undefined;
    if (!location) return atStep(DOWNLOAD_STEPS.body, () => streamToFileWithCap(first.data, destPath, maxBytes));
    first.data.destroy();
    if (new URL(location, url).protocol !== 'https:') throw new Error('El redirect del adjunto no usa https.');
    const signed = await atStep(DOWNLOAD_STEPS.signed, () =>
      axios.get(new URL(location, url).toString(), {
        responseType: 'stream',
        maxRedirects: 0,
        timeout: DOWNLOAD_CONNECT_TIMEOUT_MS,
      }),
    );
    await atStep(DOWNLOAD_STEPS.body, () => streamToFileWithCap(signed.data, destPath, maxBytes));
  }

  async createIssue(params: {
    projectKey: string;
    summary: string;
    issueTypeName: string;
    issueTypeId?: string;
    assigneeId: string;
    estimateSeconds?: number;
    dueDate?: string;
    parentKey?: string;
    // Documento ADF
    description?: unknown;
  }): Promise<{ key: string; estimateSkipped?: boolean }> {
    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      summary: params.summary,
      issuetype: params.issueTypeId ? { id: params.issueTypeId } : { name: params.issueTypeName },
      assignee: { accountId: params.assigneeId },
    };

    if (params.dueDate) fields.duedate = params.dueDate;
    if (params.estimateSeconds) {
      // Jira Cloud prefiere timetracking con texto ("1h 30m") sobre timeoriginalestimate en segundos
      const h = Math.floor(params.estimateSeconds / SECONDS_PER_HOUR);
      const m = Math.floor((params.estimateSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
      const parts = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      const estimate = parts.join(' ') || '0m';
      fields.timetracking = { originalEstimate: estimate, remainingEstimate: estimate };
    }
    if (params.parentKey) fields.parent = { key: params.parentKey };
    if (params.description) fields.description = params.description;

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

  // El contenido ya viene leído y validado por quien llama (descriptor abierto sin seguir enlaces); aquí solo se vigila el tamaño
  async uploadAttachment(issueKey: string, filename: string, data: Buffer, maxBytes: number = MAX_ATTACHMENT_BYTES): Promise<string> {
    if (data.length > maxBytes) throw new Error(`${filename} pesa más de ${maxBytes} bytes; no lo subo.`);
    const form = new FormData();
    form.append('file', new Blob([data]), filename);
    // El Content-Type por defecto es JSON: axios convertiría el formulario a JSON si no se reemplaza
    const res = await this.client.post<Array<{ id: string }>>(`/issue/${pathKey(issueKey)}/attachments`, form, {
      headers: { 'X-Atlassian-Token': 'no-check', 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
      maxBodyLength: Infinity,
    });
    const id = res.data[0]?.id;
    if (!id) throw new Error(`Jira no devolvió el id del adjunto subido a ${issueKey}.`);
    return id;
  }

  async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.client.put(`/issue/${pathKey(issueKey)}`, { fields });
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const res = await this.client.get<{ transitions: JiraTransition[] }>(`/issue/${pathKey(issueKey)}/transitions`);
    return res.data.transitions;
  }

  async doTransition(issueKey: string, transitionId: string): Promise<void> {
    await this.client.post(`/issue/${pathKey(issueKey)}/transitions`, {
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

  // Sigue nextPageToken hasta agotar resultados o llegar al tope de páginas
  async searchAllIssues(jql: string, fields: string[]): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
      const res = await this.client.post<{ issues: JiraIssue[]; nextPageToken?: string }>('/search/jql', {
        jql,
        fields,
        maxResults: SEARCH_PAGE_SIZE,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      all.push(...res.data.issues);
      nextPageToken = res.data.nextPageToken;
      if (!nextPageToken) return all;
    }
    throw new Error(`La búsqueda supera ${MAX_SEARCH_PAGES * SEARCH_PAGE_SIZE} resultados; no sigo.`);
  }

  async reparent(issueKey: string, newParentKey: string): Promise<void> {
    await this.client.put(`/issue/${pathKey(issueKey)}`, {
      fields: { parent: { key: newParentKey } },
    });
  }

  async getAssignableUsers(projectKey: string): Promise<JiraUser[]> {
    const res = await this.client.get<JiraUser[]>('/user/assignable/search', {
      params: { project: projectKey, maxResults: 50 },
    });
    return res.data;
  }

  async getIssueTypes(projectKey: string): Promise<Array<{ id: string; name: string; subtask: boolean }>> {
    const res = await this.client.get<{ issueTypes: Array<{ id: string; name: string; subtask: boolean }> }>(
      `/project/${pathProject(projectKey)}`
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
