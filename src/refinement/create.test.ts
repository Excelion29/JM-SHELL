import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { adfToMarkdown } from '../utils/adf';
import {
  buildDescriptionMarkdown,
  buildPreview,
  estimateForJira,
  findExistingMatches,
  plannedUploads,
  resolveParent,
  resolveTarget,
  runCreation,
} from './create';
import type { CreateRequest, CreationTarget } from './review-types';
import { readState } from './state';
import {
  attachment,
  attachmentsPathOf,
  createFakeJira,
  seedStory,
  statePathOf,
  storeAt,
  task,
  tempRoot,
} from './test-support';

const KEY = 'AQ-45';
const TARGET: CreationTarget = {
  parentKey: KEY,
  parentSummary: 'Resumen',
  childKind: 'subtask',
  issueTypeId: '4',
  issueTypeName: 'Subtarea',
};
const REQUEST: CreateRequest = { target: TARGET, assigneeId: 'acc-1', adopt: {} };
const FIVE_MINUTES = 300;

const tasks = (count: number) => Array.from({ length: count }, (_, i) => task(`T${i + 1}`));

test('estimateForJira redondea a 5 minutos con un mínimo de 5', () => {
  assert.equal(estimateForJira(3900), 3900);
  assert.equal(estimateForJira(4020), 3900);
  assert.equal(estimateForJira(4200), 4200);
  assert.equal(estimateForJira(60), FIVE_MINUTES);
});

test('padre: una historia viva recibe subtareas', async () => {
  const { jira } = createFakeJira({ issues: { [KEY]: {} } });
  const outcome = await resolveParent(jira, KEY);
  assert.deepEqual(outcome, { kind: 'ready', target: { ...TARGET, parentSummary: `Resumen de ${KEY}` } });
});

test('padre: una épica pregunta y ofrece la propia épica', async () => {
  const { jira } = createFakeJira({ issues: { [KEY]: { type: 'Epic' } } });
  assert.deepEqual(await resolveParent(jira, KEY), {
    kind: 'ask',
    reason: 'epic',
    epicKey: KEY,
    epicSummary: `Resumen de ${KEY}`,
  });
});

test('padre: una historia cerrada pregunta y ofrece su épica', async () => {
  const { jira } = createFakeJira({ issues: { [KEY]: { status: 'done', epic: { key: 'AQ-1', summary: 'Pagos' } } } });
  assert.deepEqual(await resolveParent(jira, KEY), {
    kind: 'ask',
    reason: 'done',
    epicKey: 'AQ-1',
    epicSummary: 'Pagos',
  });
});

test('padre: una subtarea y una clave inexistente preguntan', async () => {
  const { jira } = createFakeJira({ issues: { [KEY]: { type: 'Subtarea' } } });
  assert.equal(((await resolveParent(jira, KEY)) as { reason: string }).reason, 'subtask');
  assert.equal(((await resolveParent(jira, 'AQ-99')) as { reason: string }).reason, 'not-found');
});

test('destino manual: épica crea issues estándar, subtarea se rechaza, clave inexistente avisa', async () => {
  const { jira } = createFakeJira({ issues: { 'AQ-1': { type: 'Epic' }, 'AQ-2': { type: 'Subtarea' } } });
  const epic = await resolveTarget(jira, 'AQ-1');
  assert.ok(epic.ok && epic.target.childKind === 'standard' && epic.target.issueTypeName === 'Tarea');
  const subtask = await resolveTarget(jira, 'AQ-2');
  assert.ok(!subtask.ok && /subtarea/.test(subtask.message));
  const missing = await resolveTarget(jira, 'AQ-9');
  assert.ok(!missing.ok && /No encontré AQ-9/.test(missing.message));
  const invalid = await resolveTarget(jira, 'mala');
  assert.ok(!invalid.ok && /inválida/.test(invalid.message));
});

test('crea solo las tareas marcadas con descripción, criterio, estimación redondeada y padre', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, [task('T1'), task('T2', { include: false })], { phase: 'reviewed' });
  const { jira, calls } = createFakeJira();
  const events: string[] = [];
  const outcome = await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST, (p) =>
    events.push(`${p.index}/${p.total}:${p.step}`),
  );
  assert.ok(outcome.ok);
  assert.equal(calls.created.length, 1);
  const params = calls.created[0] as Record<string, any>;
  assert.equal(params.parentKey, KEY);
  assert.equal(params.assigneeId, 'acc-1');
  assert.equal(params.issueTypeId, '4');
  assert.equal(params.estimateSeconds, 3900);
  const markdown = adfToMarkdown(params.description);
  assert.match(markdown, /Detalle de T1/);
  assert.match(markdown, /Criterio de terminado/);
  assert.match(markdown, /- Pasa el test\n- Sin errores/);
  assert.doesNotMatch(markdown, /Estimación|esperado|riesgo/);
  assert.deepEqual(events, ['1/1:creating', '1/1:created']);
  const state = await readState(storeAt(root), KEY);
  assert.deepEqual(state?.createdIssues, { T1: 'AQ-101' });
  assert.equal(state?.phase, 'created');
});

test('es idempotente: repetir no crea de nuevo lo registrado en estado.json', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(2), { phase: 'reviewed' });
  const first = createFakeJira();
  await runCreation({ jira: first.jira, store: storeAt(root) }, KEY, REQUEST);
  const second = createFakeJira();
  const outcome = await runCreation({ jira: second.jira, store: storeAt(root) }, KEY, REQUEST);
  assert.ok(outcome.ok && outcome.created.every((c) => c.existing));
  assert.equal(second.calls.created.length, 0);
});

test('propone las tareas cuyo título ya existe en el padre leyendo sus subtareas, sin tocar el índice de búsqueda', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(2), { phase: 'reviewed' });
  const { jira, calls } = createFakeJira({ issues: { [KEY]: {} }, children: [{ key: 'AQ-7', summary: 'Tarea T2' }] });
  assert.deepEqual(await findExistingMatches(jira, storeAt(root), KEY, TARGET), [
    { taskId: 'T2', key: 'AQ-7', summary: 'Tarea T2' },
  ]);
  assert.deepEqual(calls.searches, []);
  assert.equal(calls.created.length, 0);
});

test('con padre estándar (épica) busca hijos con la búsqueda paginada', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(1), { phase: 'reviewed' });
  const { jira, calls } = createFakeJira({ children: [{ key: 'AQ-7', summary: 'Tarea T1' }] });
  const epic = { ...TARGET, parentKey: 'AQ-1', childKind: 'standard' as const };
  assert.equal((await findExistingMatches(jira, storeAt(root), KEY, epic)).length, 1);
  assert.deepEqual(calls.searches, ['parent = "AQ-1"']);
});

test('sin confirmar no se adopta: crea la tarea; confirmada, la vincula y la registra', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(2), { phase: 'reviewed' });
  const unconfirmed = createFakeJira({ children: [{ key: 'AQ-7', summary: 'Tarea T2' }] });
  assert.ok((await runCreation({ jira: unconfirmed.jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.equal(unconfirmed.calls.created.length, 2);

  const root2 = await tempRoot();
  await seedStory(storeAt(root2), KEY, tasks(2), { phase: 'reviewed' });
  const { jira, calls } = createFakeJira({ children: [{ key: 'AQ-7', summary: 'Tarea T2' }] });
  const outcome = await runCreation({ jira, store: storeAt(root2) }, KEY, { ...REQUEST, adopt: { T2: 'AQ-7' } });
  assert.ok(outcome.ok);
  assert.equal(calls.created.length, 1);
  assert.deepEqual((await readState(storeAt(root2), KEY))?.createdIssues, { T1: 'AQ-101', T2: 'AQ-7' });
  assert.equal(outcome.created[1].existing, true);
});

test('una clave adoptada inválida se rechaza antes de crear nada', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(1), { phase: 'reviewed' });
  const { jira, calls } = createFakeJira();
  const outcome = await runCreation({ jira, store: storeAt(root) }, KEY, { ...REQUEST, adopt: { T1: '../x' } });
  assert.ok(!outcome.ok && /inválida/.test(outcome.message));
  assert.equal(calls.created.length, 0);
});

test('los saltos de línea del criterio y del título no rompen la lista', async () => {
  const markdown = buildDescriptionMarkdown(task('T1', { doneCriteria: ['uno\ndos\r\n  tres', 'otro'] }));
  const root = await tempRoot();
  assert.match(markdown, /- uno dos tres\n- otro/);
  await seedStory(storeAt(root), KEY, [task('T1', { summary: 'Título\ncon salto' })], { phase: 'reviewed' });
  const { jira, calls } = createFakeJira();
  await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST);
  assert.equal(calls.created[0].summary, 'Título con salto');
});

test('si el archivo ya está en el issue (mismo nombre y tamaño) se anota sin subirlo', async () => {
  const root = await withEvidence();
  const { jira, calls } = createFakeJira({ remote: { 'AQ-101': [{ filename: 'captura.png', size: 9 }] } });
  assert.ok((await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.equal(calls.uploads.length, 0);
  const entry = (await readState(storeAt(root), KEY))?.attachments.find((a) => a.file === 'captura.png');
  assert.equal(entry?.uploaded['AQ-101'], '0');
});

test('consulta los adjuntos del issue una sola vez aunque haya varios archivos', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, [task('T1')], {
    phase: 'reviewed',
    files: { 'a.png': 'aa', 'b.png': 'bbb' },
    attachments: [
      attachment('a.png', { purpose: 'evidence', taskIds: ['T1'] }),
      attachment('b.png', { purpose: 'team', taskIds: ['T1'] }),
    ],
  });
  const { jira, calls } = createFakeJira();
  assert.ok((await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.deepEqual(calls.getAttachments, ['AQ-101']);
  assert.equal(calls.uploads.length, 2);
});

test('estado.json con claves de issue inválidas las descarta al leer', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(1), {
    phase: 'reviewed',
    files: { 'c.png': 'x' },
    attachments: [attachment('c.png')],
  });
  const file = statePathOf(root, KEY);
  const raw = await fs.readJson(file);
  raw.createdIssues = { T1: '../../etc', T2: 'AQ-5' };
  raw.attachments[0].uploaded = { '../x': 'a1', 'AQ-5': 'a2' };
  await fs.writeJson(file, raw);
  const state = await readState(storeAt(root), KEY);
  assert.deepEqual(state?.createdIssues, { T2: 'AQ-5' });
  assert.deepEqual(state?.attachments[0].uploaded, { 'AQ-5': 'a2' });
});

test('algo que no es un archivo regular en adjuntos no se sube', async () => {
  const root = await withEvidence();
  const dir = path.join(attachmentsPathOf(root, KEY), 'carpeta');
  await fs.mkdir(dir);
  const file = statePathOf(root, KEY);
  const raw = await fs.readJson(file);
  raw.attachments.push({ file: 'carpeta', purpose: 'evidence', origin: 'local', taskIds: ['T1'], uploaded: {} });
  await fs.writeJson(file, raw);
  const { jira, calls } = createFakeJira();
  const outcome = await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST);
  assert.ok(!outcome.ok);
  assert.ok(!calls.uploads.some((u) => u.file === 'carpeta'));
});

test('si falla en la tarea 3 de 5, reintentar crea solo la 3, 4 y 5', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, tasks(5), { phase: 'reviewed' });
  const failing = createFakeJira({ failCreateAt: 3 });
  const outcome = await runCreation({ jira: failing.jira, store: storeAt(root) }, KEY, REQUEST);
  assert.ok(!outcome.ok);
  assert.match(outcome.message, /caído/);
  assert.equal(outcome.created.length, 2);
  assert.deepEqual(Object.keys((await readState(storeAt(root), KEY))?.createdIssues ?? {}), ['T1', 'T2']);
  assert.equal((await readState(storeAt(root), KEY))?.phase, 'reviewed');

  const retry = createFakeJira({
    children: failing.calls.created.map((_, i) => ({ key: `AQ-${101 + i}`, summary: `Tarea T${i + 1}` })),
  });
  const done = await runCreation({ jira: retry.jira, store: storeAt(root) }, KEY, REQUEST);
  assert.ok(done.ok);
  assert.equal(retry.calls.created.length, 3);
  assert.deepEqual(
    retry.calls.created.map((c) => c.summary),
    ['Tarea T3', 'Tarea T4', 'Tarea T5'],
  );
  assert.equal(Object.keys((await readState(storeAt(root), KEY))?.createdIssues ?? {}).length, 5);
  assert.equal((await readState(storeAt(root), KEY))?.phase, 'created');
});

async function withEvidence(extra: Parameters<typeof seedStory>[3] = {}) {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, [task('T1'), task('T2')], {
    phase: 'reviewed',
    files: { 'captura.png': 'contenido', 'notas.txt': 'solo analisis' },
    attachments: [
      attachment('captura.png', { purpose: 'evidence', taskIds: ['T1'] }),
      attachment('notas.txt', { purpose: 'analysis', taskIds: ['T1'] }),
    ],
    ...extra,
  });
  return root;
}

test('sube la evidencia a su tarea, la registra y no la repite', async () => {
  const root = await withEvidence();
  const first = createFakeJira();
  assert.ok((await runCreation({ jira: first.jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.deepEqual(first.calls.uploads, [{ issueKey: 'AQ-101', file: 'captura.png' }]);
  const entry = (await readState(storeAt(root), KEY))?.attachments.find((a) => a.file === 'captura.png');
  assert.deepEqual(entry?.uploaded, { 'AQ-101': 'att-1' });

  const second = createFakeJira();
  assert.ok((await runCreation({ jira: second.jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.equal(second.calls.uploads.length, 0);
});

test('si la subida falla la tarea queda registrada y el reintento solo sube lo pendiente', async () => {
  const root = await withEvidence();
  const failing = createFakeJira({ failUploads: true });
  const outcome = await runCreation({ jira: failing.jira, store: storeAt(root) }, KEY, REQUEST);
  assert.ok(!outcome.ok && /413/.test(outcome.message));
  assert.equal((await readState(storeAt(root), KEY))?.createdIssues.T1, 'AQ-101');
  const retry = createFakeJira();
  assert.ok((await runCreation({ jira: retry.jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.equal(retry.calls.created.length, 1);
  assert.deepEqual(retry.calls.uploads, [{ issueKey: 'AQ-101', file: 'captura.png' }]);
});

test('plannedUploads ignora análisis y tareas sin marcar', async () => {
  const root = await withEvidence();
  const state = await readState(storeAt(root), KEY);
  const plan = { storyKey: KEY, tasks: [task('T1', { include: false }), task('T2')] };
  assert.deepEqual(plannedUploads(state!, plan), []);
  assert.deepEqual(plannedUploads(state!, { ...plan, tasks: [task('T1'), task('T2')] }), [
    { file: 'captura.png', purpose: 'evidence', taskIds: ['T1'] },
  ]);
});

test('respeta el tope de tamaño antes de subir', async () => {
  const root = await withEvidence();
  const { jira, calls } = createFakeJira();
  const outcome = await runCreation({ jira, store: storeAt(root), maxUploadBytes: 5 }, KEY, REQUEST);
  assert.ok(!outcome.ok && /pesa más de/.test(outcome.message));
  assert.equal(calls.uploads.length, 0);
});

test('un nombre con recorrido de ruta escrito a mano en estado.json se descarta y no se sube', async () => {
  const root = await withEvidence();
  const file = statePathOf(root, KEY);
  const raw = await fs.readJson(file);
  raw.attachments.push({
    file: '../../secreto.txt',
    purpose: 'evidence',
    origin: 'local',
    taskIds: ['T1'],
    uploaded: {},
  });
  await fs.writeJson(file, raw);
  const { jira, calls } = createFakeJira();
  assert.ok((await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST)).ok);
  assert.deepEqual(
    calls.uploads.map((u) => u.file),
    ['captura.png'],
  );
});

test('un enlace simbólico dentro de adjuntos no se sube', async (t) => {
  const root = await withEvidence();
  const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-out-')), 'secreto.txt');
  await fs.writeFile(outside, 'secreto');
  const link = path.join(attachmentsPathOf(root, KEY), 'enlace.txt');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    t.skip('este sistema no permite crear enlaces simbólicos sin privilegios');
    return;
  }
  const file = statePathOf(root, KEY);
  const raw = await fs.readJson(file);
  raw.attachments.push({ file: 'enlace.txt', purpose: 'evidence', origin: 'local', taskIds: ['T1'], uploaded: {} });
  await fs.writeJson(file, raw);
  const { jira, calls } = createFakeJira();
  const outcome = await runCreation({ jira, store: storeAt(root) }, KEY, REQUEST);
  assert.ok(!outcome.ok && /enlace/.test(outcome.message));
  assert.ok(!calls.uploads.some((u) => u.file === 'enlace.txt'));
});

const THURSDAY = '2026-11-05';
const ONE_HOUR = 3600;

test('la descripción no lleva estimación ni PERT: el tiempo va solo en el campo de Jira', () => {
  const markdown = buildDescriptionMarkdown(task('T1', { finalEstimate: '3h' }));
  assert.doesNotMatch(markdown, /Estimación|PERT|esperado|riesgo/);
});

test('crea con la estimación propia del dev y la fecha recomendada; sin ella, la recomendación redondeada', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, [task('T1', { finalEstimate: '3h' }), task('T2'), task('T3')], {
    phase: 'reviewed',
  });
  const { jira, calls } = createFakeJira();
  const outcome = await runCreation({ jira, store: storeAt(root), today: THURSDAY }, KEY, REQUEST);
  assert.ok(outcome.ok);
  const sent = calls.created.map((p) => [p.estimateSeconds, p.dueDate]);
  // 3h + 1h05 + 1h05 caben en un día
  assert.deepEqual(sent, [
    [3 * ONE_HOUR, THURSDAY],
    [3900, THURSDAY],
    [3900, THURSDAY],
  ]);
});

test('crea con la fecha manual y pasa al día siguiente lo que ya no cabe', async () => {
  const root = await tempRoot();
  await seedStory(
    storeAt(root),
    KEY,
    [task('T1', { finalEstimate: '7h' }), task('T2', { dueDate: '2026-11-08', dueDateManual: true }), task('T3')],
    { phase: 'reviewed' },
  );
  const { jira, calls } = createFakeJira();
  await runCreation({ jira, store: storeAt(root), today: THURSDAY }, KEY, REQUEST);
  assert.deepEqual(
    calls.created.map((p) => p.dueDate),
    [THURSDAY, '2026-11-08', '2026-11-06'],
  );
});

test('la vista previa suma lo que irá a Jira y la creación no usa transiciones', async () => {
  const root = await tempRoot();
  await seedStory(storeAt(root), KEY, [task('T1', { finalEstimate: '3h' }), task('T2')], { phase: 'reviewed' });
  const { jira } = createFakeJira({ issues: { [KEY]: {} } });
  const preview = await buildPreview(jira, storeAt(root), KEY, { accountId: 'acc-1', displayName: 'Yo' });
  assert.equal(preview.estimateSeconds, 3 * ONE_HOUR + 3900);
  // CreateJira no expone transiciones: crear no puede mover la tarea de su estado inicial
  assert.equal('doTransition' in jira || 'transitionToStatus' in jira, false);
});
