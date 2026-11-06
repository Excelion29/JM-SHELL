import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { JiraService } from '../services/jira';
import type { JiraAttachment, JiraIssue } from '../config/types';
import { MAX_ATTACHMENT_BYTES } from '../refinement/attachments';
import { readState } from '../refinement/state';
import { storeAt } from '../refinement/test-support';
import { prepareStory } from './refine';

const KEY = 'AQ-45';
const ATTACHMENT_COUNT = 7;
const DOWNLOAD_DELAY_MS = 20;
const MAX_CONCURRENT = 3;

const attachment = (n: number): JiraAttachment =>
  ({ id: String(n), filename: `doc${n}.txt`, size: 10, content: `https://jira.test/att/${n}` }) as JiraAttachment;

const issue = { key: KEY, fields: { summary: 'Login', status: { name: 'Open' }, description: null } } as unknown as JiraIssue;

interface FakeOptions {
  failing?: Set<string>;
  failureMessage?: string;
  failureCode?: string;
}

function fakeJira(attachments: JiraAttachment[], { failing = new Set<string>(), failureMessage = 'boom', failureCode }: FakeOptions = {}) {
  const stats = { active: 0, peak: 0, calls: 0 };
  const jira = {
    getIssueWithDescription: async () => issue,
    getAttachments: async () => attachments,
    downloadAttachmentBuffer: async (url: string) => {
      stats.calls += 1;
      stats.active += 1;
      stats.peak = Math.max(stats.peak, stats.active);
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_DELAY_MS));
      stats.active -= 1;
      if (failing.has(url)) throw Object.assign(new Error(failureMessage), { code: failureCode });
      return Buffer.from('contenido');
    },
  } as unknown as JiraService;
  return { jira, stats };
}

const tempStore = async () => storeAt(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-refine-')), KEY);

test('las descargas respetan el tope de concurrencia y no duplican entradas en el estado', async () => {
  const store = await tempStore();
  const { jira, stats } = fakeJira(Array.from({ length: ATTACHMENT_COUNT }, (_, i) => attachment(i + 1)));
  const reports: string[] = [];
  await prepareStory(jira, store, KEY, (m) => reports.push(m), null);
  assert.equal(stats.calls, ATTACHMENT_COUNT);
  assert.equal(stats.peak, MAX_CONCURRENT);
  assert.equal(reports.length, 0);
  const files = (await readState(store, KEY))?.attachments.map((a) => a.file) ?? [];
  assert.equal(files.length, ATTACHMENT_COUNT);
  assert.equal(new Set(files).size, ATTACHMENT_COUNT);

  await prepareStory(jira, store, KEY, (m) => reports.push(m), null);
  assert.equal(stats.calls, ATTACHMENT_COUNT, 'lo ya descargado no se vuelve a pedir');
  assert.equal((await readState(store, KEY))?.attachments.length, ATTACHMENT_COUNT);
});

test('los fallos se resumen en una sola línea con el paso que falló, sin registrar los adjuntos fallidos', async () => {
  const store = await tempStore();
  const all = Array.from({ length: ATTACHMENT_COUNT }, (_, i) => attachment(i + 1));
  const { jira } = fakeJira(all, {
    failing: new Set(all.map((a) => a.content)),
    failureMessage: 'falló el redirect firmado: timeout of 15000ms exceeded',
    failureCode: 'ECONNABORTED',
  });
  const reports: string[] = [];
  await prepareStory(jira, store, KEY, (m) => reports.push(m), null);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /No pude descargar 7 adjuntos \(tiempo de espera\)\. Siguen en Jira\./);
  assert.match(reports[0], /redirect firmado/);
  assert.equal((await readState(store, KEY))?.attachments.length, 0);
});

test('un fallo con otro código no se presenta como tiempo de espera aunque el mensaje lo diga', async () => {
  const store = await tempStore();
  const all = [attachment(1)];
  const { jira } = fakeJira(all, { failing: new Set([all[0].content]), failureMessage: 'timeout raro', failureCode: 'ECONNRESET' });
  const reports: string[] = [];
  await prepareStory(jira, store, KEY, (m) => reports.push(m), null);
  assert.match(reports[0], /No pude descargar 1 adjunto \(error\)/);
});

test('los adjuntos que superan el tope se resumen en una sola línea', async () => {
  const store = await tempStore();
  const big = [1, 2, 3].map((n) => ({ ...attachment(n), size: MAX_ATTACHMENT_BYTES + 1 }));
  const { jira, stats } = fakeJira(big);
  const reports: string[] = [];
  await prepareStory(jira, store, KEY, (m) => reports.push(m), null);
  assert.equal(stats.calls, 0);
  assert.deepEqual(reports, ['Omití 3 adjuntos por tamaño (más de 20 MB). Descárgalos a mano si los necesitas.']);
});
