import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atStep, isTimeoutError, JiraService } from './jira';

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
