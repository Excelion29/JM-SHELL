import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AxiosError } from 'axios';
import {
  atStep,
  IssueNotFoundError,
  isTimeoutError,
  JIRA_ERROR_TEXTS,
  JiraService,
  MAX_ERROR_DETAIL_CHARS,
  toJiraError,
} from './jira';

const CONFIG = { jiraUrl: 'https://acme.atlassian.net', email: 'a@b.c', apiToken: 'x' };

test('uploadAttachment rechaza un contenido sobre el tope sin llamar a Jira', async () => {
  await assert.rejects(
    new JiraService(CONFIG).uploadAttachment('AQ-1', 'grande.bin', Buffer.alloc(10), 5),
    /pesa más de 5 bytes/,
  );
});

test('una clave con ruta o query nunca llega a la URL REST', async () => {
  const jira = new JiraService(CONFIG);
  for (const bad of ['../../x', 'AQ-1?expand=all', 'AQ-1/attachments', '']) {
    await assert.rejects(jira.getIssue(bad), /inválida/);
    await assert.rejects(jira.getAttachments(bad), /inválida/);
    await assert.rejects(jira.uploadAttachment(bad, 'a.txt', Buffer.alloc(1)), /inválida/);
  }
  await assert.rejects(jira.getIssueTypes('../x'), /inválida/);
});

test('atStep conserva el code del error original y solo los códigos de tiempo cuentan como timeout', async () => {
  for (const code of ['ECONNABORTED', 'ETIMEDOUT']) {
    const err = await atStep('x', () => Promise.reject(Object.assign(new Error('a'), { code }))).catch((e) => e);
    assert.equal(err.code, code);
    assert.match(err.message, /^falló x: a$/);
    assert.equal(isTimeoutError(err), true);
  }
  const reset = await atStep('x', () => Promise.reject(Object.assign(new Error('timeout'), { code: 'ECONNRESET' }))).catch((e) => e);
  assert.equal(isTimeoutError(reset), false);
  assert.equal(isTimeoutError(new Error('timeout')), false);
});

test('createIssue envía fecha y estimación en una sola llamada y nunca transiciona la tarea', async () => {
  const jira = new JiraService(CONFIG);
  const posts: Array<{ url: string; body: { fields: Record<string, unknown> } }> = [];
  (jira as unknown as { client: unknown }).client = {
    post: async (url: string, body: { fields: Record<string, unknown> }) => {
      posts.push({ url, body });
      return { data: { id: '1', key: 'AQ-9' } };
    },
  };
  const result = await jira.createIssue({
    projectKey: 'AQ',
    summary: 'Tarea',
    issueTypeName: 'Tarea',
    assigneeId: 'acc-1',
    estimateSeconds: 3 * 3600,
    dueDate: '2026-11-06',
  });
  assert.equal(result.key, 'AQ-9');
  assert.deepEqual(posts.map((p) => p.url), ['/issue']);
  assert.equal(posts[0].body.fields.duedate, '2026-11-06');
  assert.deepEqual(posts[0].body.fields.timetracking, { originalEstimate: '3h', remainingEstimate: '3h' });
  assert.equal('transition' in posts[0].body, false);
});

const axiosError = (status?: number, data?: unknown, code?: string): AxiosError =>
  ({ message: 'Request failed', code, response: status === undefined ? undefined : { status, data } }) as AxiosError;

test('sin respuesta de Jira dice que no pudo conectar, o que tardó si fue tiempo, y conserva el code', () => {
  const offline = toJiraError(axiosError(undefined, undefined, 'ENOTFOUND'));
  assert.equal(offline.message, JIRA_ERROR_TEXTS.unreachable);
  assert.equal(offline.code, 'ENOTFOUND');
  assert.ok(!offline.message.includes('undefined'));
  const slow = toJiraError(axiosError(undefined, undefined, 'ETIMEDOUT'));
  assert.equal(slow.message, JIRA_ERROR_TEXTS.timeout);
  assert.equal(isTimeoutError(slow), true);
});

test('cada código HTTP se traduce a qué pasó y qué hacer, con el detalle de Jira y el status aparte', () => {
  const detail = { errorMessages: ['No puedes editar AQ-1'] };
  assert.equal(toJiraError(axiosError(401)).message, JIRA_ERROR_TEXTS.unauthorized);
  assert.equal(toJiraError(axiosError(403, detail)).message, JIRA_ERROR_TEXTS.forbidden('No puedes editar AQ-1'));
  const missing = toJiraError(axiosError(404, detail));
  assert.ok(missing instanceof IssueNotFoundError);
  assert.equal(missing.status, 404);
  assert.equal(toJiraError(axiosError(429)).message, JIRA_ERROR_TEXTS.rateLimited);
  assert.equal(toJiraError(axiosError(503)).message, JIRA_ERROR_TEXTS.serverError(503));
  const rejected = toJiraError(axiosError(400, { errors: { duedate: 'Fecha inválida' } }));
  assert.equal(rejected.message, JIRA_ERROR_TEXTS.rejected('Fecha inválida'));
  assert.equal(rejected.status, 400);
  assert.equal(toJiraError(axiosError(409)).message, JIRA_ERROR_TEXTS.other(409, 'Request failed'));
});

test('el detalle de Jira ignora lo que no es texto y se recorta si es muy largo', () => {
  const mixed = toJiraError(axiosError(400, { errorMessages: ['Campo inválido', 42], errors: { a: { x: 1 } } }));
  assert.equal(mixed.message, JIRA_ERROR_TEXTS.rejected('Campo inválido'));
  const long = toJiraError(axiosError(400, { errorMessages: ['x'.repeat(MAX_ERROR_DETAIL_CHARS + 50)] }));
  assert.ok(long.message.length < JIRA_ERROR_TEXTS.rejected('').length + MAX_ERROR_DETAIL_CHARS + 5);
  const html = toJiraError(axiosError(502, '<html>proxy</html>'));
  assert.equal(html.message, JIRA_ERROR_TEXTS.serverError(502));
});
