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
