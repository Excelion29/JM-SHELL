import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
const DOWNLOAD_TEMP_PREFIX = 'jm-adjunto-';
const DOWNLOAD_TEMP_FILE = 'descarga';

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

// Error de Jira ya traducido para el dev; status y code quedan aparte para decidir sin leer el texto
export class JiraApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
  }
}

export class IssueNotFoundError extends JiraApiError {}

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

// Sin punto final: las pantallas suelen añadir detrás qué hacer («Reintenta con r»)
export const JIRA_ERROR_TEXTS = {
  timeout: 'Jira tardó demasiado en responder: revisa tu conexión o la VPN y reintenta',
  unreachable: 'No pude conectar con Jira: revisa tu conexión o la VPN y reintenta',
  unauthorized: 'Jira rechazó tus credenciales: revisa el correo y el token con `jm init`',
  forbidden: (detail: string) => `No tienes permiso en Jira para esto (${detail}): pídelo al admin del proyecto`,
  notFound: (detail: string) => `No encontré eso en Jira, pudo borrarse o moverse (${detail})`,
  rateLimited: 'Jira está frenando las peticiones: espera un minuto y reintenta',
  serverError: (status: number) => `Jira no está respondiendo bien (error ${status}): reintenta en unos minutos`,
  rejected: (detail: string) => `Jira no aceptó los datos: ${detail}`,
  other: (status: number, detail: string) => `Jira respondió con error ${status}: ${detail}`,
} as const;

// Tope del detalle de Jira en pantalla: un 4xx puede repetir JQL o datos largos del issue
export const MAX_ERROR_DETAIL_CHARS = 300;
const DETAIL_ELLIPSIS = '…';

const onlyStrings = (values: unknown): string[] =>
  Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];

function jiraDetail(err: AxiosError): string {
  const data = err.response?.data;
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const errors = body.errors && typeof body.errors === 'object' ? Object.values(body.errors) : [];
  const detail = [...onlyStrings(body.errorMessages), ...onlyStrings(errors)].join('; ') || err.message;
  return detail.length > MAX_ERROR_DETAIL_CHARS
    ? `${detail.slice(0, MAX_ERROR_DETAIL_CHARS)}${DETAIL_ELLIPSIS}`
    : detail;
}

// Qué pasó en español y qué hacer; el detalle de Jira se conserva porque suele decir qué campo o recurso falló
export function toJiraError(err: AxiosError): JiraApiError {
  const status = err.response?.status;
  const code = err.code;
  if (status === undefined) {
    const text = code && TIMEOUT_ERROR_CODES.has(code) ? JIRA_ERROR_TEXTS.timeout : JIRA_ERROR_TEXTS.unreachable;
    return new JiraApiError(text, undefined, code);
  }
  const detail = jiraDetail(err);
  if (status === HTTP_UNAUTHORIZED) return new JiraApiError(JIRA_ERROR_TEXTS.unauthorized, status, code);
  if (status === HTTP_FORBIDDEN) return new JiraApiError(JIRA_ERROR_TEXTS.forbidden(detail), status, code);
  if (status === HTTP_NOT_FOUND) return new IssueNotFoundError(JIRA_ERROR_TEXTS.notFound(detail), status, code);
  if (status === HTTP_TOO_MANY_REQUESTS) return new JiraApiError(JIRA_ERROR_TEXTS.rateLimited, status, code);
  if (status >= HTTP_SERVER_ERROR) return new JiraApiError(JIRA_ERROR_TEXTS.serverError(status), status, code);
  if (status === HTTP_BAD_REQUEST) return new JiraApiError(JIRA_ERROR_TEXTS.rejected(detail), status, code);
  return new JiraApiError(JIRA_ERROR_TEXTS.other(status, detail), status, code);
}

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
        throw toJiraError(err);
      },
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

  // El destino final puede ser la bóveda: se descarga a un temporal (con el mismo tope) y se devuelven los bytes
  async downloadAttachmentBuffer(url: string, maxBytes: number = MAX_ATTACHMENT_BYTES): Promise<Buffer> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), DOWNLOAD_TEMP_PREFIX));
    try {
      const temp = path.join(dir, DOWNLOAD_TEMP_FILE);
      await this.downloadAttachment(url, temp, maxBytes);
      return await fs.promises.readFile(temp);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
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
  async uploadAttachment(
    issueKey: string,
    filename: string,
    data: Buffer,
    maxBytes: number = MAX_ATTACHMENT_BYTES,
  ): Promise<string> {
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

  async deleteIssue(issueKey: string): Promise<void> {
    await this.client.delete(`/issue/${pathKey(issueKey)}`);
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

  async searchIssues(
    jql: string,
    fields: string[] = ['summary', 'status', 'assignee', 'issuetype', 'parent'],
  ): Promise<JiraIssue[]> {
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
      `/project/${pathProject(projectKey)}`,
    );
    return (
      (res.data as unknown as { issueTypes: Array<{ id: string; name: string; subtask: boolean }> }).issueTypes ?? []
    );
  }

  async getProjects(): Promise<Array<{ key: string; name: string; projectTypeKey: string }>> {
    const res = await this.client.get<{ values: Array<{ key: string; name: string; projectTypeKey: string }> }>(
      '/project/search',
      { params: { maxResults: 100, orderBy: 'name' } },
    );
    return res.data.values;
  }
}
