import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { advanceAnalysisPhase, analysisSummary, createAnalysis, readAnalysis, updateAnalysis } from './analysis';
import { loadPoints, pointsTotals, PointsValidationError, validatePoints } from './analysis-points';
import { ANALYSIS_BLOCKS, ANALYSIS_PHASES } from './analysis-types';
import type { ChatKnowledge } from './chat-types';
import { buildChatArgs, buildChatSettings, ChatProcess, ChatSession, ChatSpawner } from './claude-chat';
import { assertSafeArgs, chatAllowedTools, CHAT_FILES, isAnalysisKey, workFilesOf } from './claude';
import { createAnalysisProjectStore } from './project-store';
import { buildNotesMessage, cleanNotePath, mergeReferencedNotes, readReferencedNotes } from './referenced-notes';
import { readState } from './state';
import { createLocalStore } from './local-store';
import { tempRoot } from './test-support';
import { workDirFor } from './workdir';

const SESSION = '123e4567-e89b-12d3-a456-426614174000';
const ANALYSIS = 'an-3';
const STORY = 'AQ-45';
const WORK_DIR = workDirFor(path.join(os.tmpdir(), 'jm-proyecto-de-prueba'));
const ANALYSIS_SKILL = path.join(WORK_DIR, CHAT_FILES.analysisSkill);
const AGENTS = path.join(WORK_DIR, CHAT_FILES.agents);
const SETTINGS = path.join(WORK_DIR, CHAT_FILES.settings);
const LOCAL_KB: ChatKnowledge = { type: 'local', root: 'C:\\vault', adrDir: 'C:/vault/Proyectos/06-JM-ADR' };
const MCP_KB: ChatKnowledge = { type: 'mcp' };
const NOW = new Date('2026-11-09T15:00:00.000Z');

const argsFor = (key: string, kb: ChatKnowledge | null = null) =>
  buildChatArgs({
    key,
    model: 'sonnet',
    sessionId: SESSION,
    resume: false,
    skillFile: ANALYSIS_SKILL,
    agentsFile: AGENTS,
    settingsFile: SETTINGS,
    kb,
    mcpFile: path.join(WORK_DIR, CHAT_FILES.mcp),
    attachmentsDir: workFilesOf(WORK_DIR, key).attachments,
  });

test('un id de análisis: el allowlist escribe solo en .jm/analisis/<id> y los argumentos pasan la última barrera', () => {
  assert.equal(isAnalysisKey(ANALYSIS), true);
  assert.equal(isAnalysisKey(STORY), false);
  const args = argsFor(ANALYSIS);
  assert.ok(args.includes('Read,Grep,Glob,Task,Agent,Write(.jm/analisis/an-3/**),Edit(.jm/analisis/an-3/**)'));
  assert.doesNotThrow(() => assertSafeArgs(args));
  assert.doesNotThrow(() => assertSafeArgs(argsFor(ANALYSIS, MCP_KB)));
  assert.throws(() => argsFor('an-3/../x'), /inválida/);
  assert.throws(() => argsFor('an-3**),Bash(*'), /inválida/);
  assert.throws(() => argsFor('an-1234567'), /inválida/);
});

test('las reglas de historias no cambian y no se cruzan con las de análisis', () => {
  assert.equal(
    chatAllowedTools(STORY),
    'Read,Grep,Glob,Task,Agent,Write(.jm/historias/AQ-45/**),Edit(.jm/historias/AQ-45/**)',
  );
  const storyRule = chatAllowedTools(STORY);
  const analysisRule = chatAllowedTools(ANALYSIS);
  assert.doesNotThrow(() => assertSafeArgs([storyRule]));
  assert.doesNotThrow(() => assertSafeArgs([analysisRule]));
  // Una ruta de análisis con la herramienta de historias y al revés no pasan
  assert.throws(
    () => assertSafeArgs(['Read,Grep,Glob,Task,Agent,Write(.jm/historias/an-3/**),Edit(.jm/historias/an-3/**)']),
    /no permitido/,
  );
  assert.throws(
    () => assertSafeArgs(['Read,Grep,Glob,Task,Agent,Write(.jm/analisis/AQ-45/**),Edit(.jm/analisis/AQ-45/**)']),
    /no permitido/,
  );
  assert.throws(
    () => assertSafeArgs(['Read,Grep,Glob,Task,Agent,Write(.jm/analisis/an-3/**),Edit(.jm/historias/AQ-45/**)']),
    /no permitido/,
  );
});

test('el análisis con base local solo escribe en su carpeta; la historia conserva su carpeta y su nota', () => {
  const analysis = buildChatSettings(ANALYSIS, LOCAL_KB) as { permissions: { allow: string[]; deny: string[] } };
  const rules = analysis.permissions.allow.filter((rule) => /^(Write|Edit)/.test(rule));
  assert.deepEqual(rules, [
    'Write(//c/vault/Proyectos/06-JM-ADR/analisis/an-3/**)',
    'Edit(//c/vault/Proyectos/06-JM-ADR/analisis/an-3/**)',
  ]);
  const story = buildChatSettings(STORY, LOCAL_KB) as { permissions: { allow: string[] } };
  assert.ok(story.permissions.allow.includes('Write(//c/vault/Proyectos/06-JM-ADR/AQ-45.md)'));
  assert.ok(story.permissions.allow.includes('Write(//c/vault/Proyectos/06-JM-ADR/AQ-45/**)'));
  const fallback = buildChatSettings(ANALYSIS) as { permissions: { allow: string[]; deny: string[] } };
  assert.ok(fallback.permissions.allow.includes('Write(.jm/analisis/an-3/**)'));
  assert.ok(!fallback.permissions.allow.some((rule) => rule.startsWith('Bash')));
});

test('la copia de adjuntos de un análisis (--add-dir con MCP) pasa y una carpeta ajena no', () => {
  assert.doesNotThrow(() =>
    assertSafeArgs(argsFor(ANALYSIS, MCP_KB), WORK_DIR.slice(0, WORK_DIR.lastIndexOf(path.sep))),
  );
  assert.throws(
    () =>
      assertSafeArgs(
        ['--add-dir', path.join(WORK_DIR, 'adjuntos', 'otra')],
        WORK_DIR.slice(0, WORK_DIR.lastIndexOf(path.sep)),
      ),
    /no permitido/,
  );
});

interface FakeProc extends ChatProcess {
  args: string[];
  written: string[];
}

function sessionHarness(subjectName?: string) {
  const procs: FakeProc[] = [];
  const saved: string[] = [];
  const spawner: ChatSpawner = (args) => {
    const proc: FakeProc = {
      args,
      written: [],
      write: (text) => void proc.written.push(text),
      end: () => undefined,
      kill: () => undefined,
      onData: () => undefined,
      onStderr: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
    };
    procs.push(proc);
    return proc;
  };
  const session = new ChatSession({
    root: 'C:\\proj',
    skillFile: ANALYSIS_SKILL,
    agentsFile: AGENTS,
    settingsFile: SETTINGS,
    subjectName,
    spawner,
    saveSessionId: (id) => void saved.push(id),
    newSessionId: () => SESSION,
  });
  return { session, procs, saved };
}

const userText = (written: string) => JSON.parse(written).message.content as string;

test('el mensaje inicial de un análisis sigue la skill analizar con su id y nombre', async () => {
  const h = sessionHarness('Observaciones');
  await h.session.start({ key: ANALYSIS, sessionId: null, model: 'sonnet' });
  assert.deepEqual(h.saved, [SESSION]);
  assert.equal(userText(h.procs[0].written[0]), 'Sigue la skill analizar para el análisis an-3 (Observaciones).');
});

test('con sesión previa el análisis retoma con la variante desde la bitácora', async () => {
  const h = sessionHarness('Observaciones');
  await h.session.start({ key: ANALYSIS, sessionId: null, model: 'sonnet', hasHistory: true });
  assert.equal(h.procs.length, 0, 'no lanza nada hasta el primer mensaje del dev');
  h.session.send('sigamos');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(userText(h.procs[0].written[0]), /sesión nueva del análisis an-3.*bitacora\.md/s);
  assert.match(userText(h.procs[0].written[0]), /sigamos$/);
  await h.session.startFromLog();
  assert.match(userText(h.procs[1].written[0]), /sesión nueva del análisis an-3/);
});

test('estado del análisis: conserva fase, bloque, sesión, uso y notas, y sanea lo inválido', async () => {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, 'an-1');
  await createAnalysis(store, 'an-1', 'Obs', 'AQ', NOW);
  const state = await readAnalysis(store, 'an-1');
  assert.equal(state?.phase, 'sources');
  assert.equal(state?.block, null);
  assert.equal(state?.claudeSessionId, null);
  assert.equal(state?.usage.turns, 0);
  assert.equal(state?.referencedNotes, undefined);

  const raw = JSON.parse((await store.readText('estado.json')) as string) as Record<string, unknown>;
  await store.writeText(
    'estado.json',
    JSON.stringify({
      ...raw,
      phase: 'documented',
      block: 'proposal',
      claudeSessionId: SESSION,
      usage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, costUsd: 1.5, turns: 2 },
      referencedNotes: ['Proyectos/a.md', '../fuera.md', '/abs.md', 'C:/x.md', 'sin-extension', 'Proyectos/a.md', 7],
    }),
  );
  const read = await readAnalysis(store, 'an-1');
  assert.equal(read?.phase, 'documented');
  assert.equal(read?.block, 'proposal');
  assert.equal(read?.claudeSessionId, SESSION);
  assert.equal(read?.usage.costUsd, 1.5);
  assert.deepEqual(read?.referencedNotes, ['Proyectos/a.md']);

  await store.writeText(
    'estado.json',
    JSON.stringify({ ...raw, phase: 'otra', block: 'xyz', claudeSessionId: 'no-es-uuid; calc' }),
  );
  const bad = await readAnalysis(store, 'an-1');
  assert.equal(bad?.phase, 'sources');
  assert.equal(bad?.block, null);
  assert.equal(bad?.claudeSessionId, null);
  assert.ok(ANALYSIS_PHASES.includes(bad!.phase) && ANALYSIS_BLOCKS.every((b) => typeof b === 'string'));
});

test('updateAnalysis conserva lo que escribió la skill; advanceAnalysisPhase nunca retrocede', async () => {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, 'an-1');
  await createAnalysis(store, 'an-1', 'Obs', 'AQ', NOW);
  assert.equal((await advanceAnalysisPhase(store, 'an-1', 'debate')).phase, 'debate');
  await updateAnalysis(store, 'an-1', (s) => {
    s.phase = 'documented';
  });
  assert.equal((await advanceAnalysisPhase(store, 'an-1', 'debate')).phase, 'documented');
  const state = await readAnalysis(store, 'an-1');
  assert.equal(analysisSummary(state!).phase, 'documentado');
  assert.match(analysisSummary(state!).nextStep, /Documentos listos/);
});

test('notas referenciadas: solo .md relativas a la bóveda, sin trucos', () => {
  assert.equal(cleanNotePath('Proyectos/Notas/a b.md'), 'Proyectos/Notas/a b.md');
  assert.equal(cleanNotePath('  Proyectos/ñandú.md '), 'Proyectos/ñandú.md');
  for (const bad of [
    '',
    'a.txt',
    '/abs/a.md',
    'C:/a.md',
    'c:\\a.md',
    '../a.md',
    'a/../b.md',
    'a\\b.md',
    '.obsidian/a.md',
    'a//b.md',
    'a/\u0000b.md',
    `${'x'.repeat(400)}.md`,
  ]) {
    assert.equal(cleanNotePath(bad), null, JSON.stringify(bad));
  }
  assert.equal(cleanNotePath(42), null);
  assert.deepEqual(readReferencedNotes('nada'), []);
  assert.deepEqual(mergeReferencedNotes(['a.md'], ['b.md', 'a.md']), ['a.md', 'b.md']);
  assert.throws(() => mergeReferencedNotes([], ['../x.md']), /no válida/);
  const many = Array.from({ length: 51 }, (_, i) => `n${i}.md`);
  assert.throws(() => mergeReferencedNotes([], many), /hasta 50/);
});

test('el mensaje de notas usa la ruta absoluta con base local y la de la bóveda con MCP', () => {
  const local = buildNotesMessage(['Proyectos/a.md'], LOCAL_KB);
  assert.match(local, /con Read/);
  assert.match(local, /- `C:\/vault\/Proyectos\/a\.md`/);
  const mcp = buildNotesMessage(['Proyectos/a.md'], MCP_KB);
  assert.match(mcp, /vault_read/);
  assert.match(mcp, /- `Proyectos\/a\.md`/);
});

const point = (patch: Record<string, unknown> = {}) => ({
  id: 'P1',
  title: 'La guardia no queda guardada',
  analysis: 'Pasa hoy',
  proposal: 'Guardar el id',
  outOfScope: false,
  estimate: { optimistic: '30m', likely: '1h', pessimistic: '2h' },
  risk: 'low',
  ...patch,
});

test('puntos.json: valida el formato y suma solo los puntos en alcance', () => {
  const points = validatePoints({
    points: [
      point(),
      point({ id: 'P2', estimate: { optimistic: '1h', likely: '1h', pessimistic: '1h' } }),
      point({ id: 'P3', outOfScope: true, estimate: undefined }),
    ],
  });
  assert.equal(points.length, 3);
  assert.equal(points[2].estimate, null);
  const totals = pointsTotals(points);
  assert.equal(totals.pointCount, 2);
  // P1 = (30m + 4*1h + 2h) / 6 = 1h05m; P2 = 1h
  assert.equal(totals.expectedSeconds, 3900 + 3600);
});

test('puntos.json: rechaza lo inválido con un mensaje claro', () => {
  const invalid: Array<[unknown, RegExp]> = [
    ['x', /"points"/],
    [{ points: 'no' }, /"points"/],
    [{ points: [point({ id: '' })] }, /"id"/],
    [{ points: [point({ risk: 'huge' })] }, /risk/],
    [{ points: [point({ outOfScope: 'no' })] }, /outOfScope/],
    [{ points: [point({ estimate: undefined })] }, /estimate/],
    [{ points: [point({ estimate: { optimistic: '2h', likely: '1h', pessimistic: '3h' } })] }, /estimación inválida/],
    [{ points: [point(), point()] }, /repetido/],
    [{ points: [null] }, /no es un objeto/],
  ];
  for (const [raw, message] of invalid) assert.throws(() => validatePoints(raw), message);
  assert.throws(() => validatePoints({ points: [point({ title: 5 })] }), PointsValidationError);
});

test('loadPoints: null sin archivo y error claro con JSON roto', async () => {
  const root = await tempRoot();
  const store = createLocalStore({ kind: 'project', anchor: root, dir: path.join(root, 'an-1') });
  assert.equal(await loadPoints(store), null);
  await store.ensureReady();
  await store.writeText('puntos.json', '{ roto');
  await assert.rejects(() => loadPoints(store), PointsValidationError);
  await store.writeText('puntos.json', JSON.stringify({ points: [point()] }));
  assert.equal((await loadPoints(store))?.length, 1);
});

test('un análisis no escribe estado de historia: readState de su id falla por formato', async () => {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, 'an-1');
  await assert.rejects(() => readState(store, 'an-1'), /inválida/);
});
