import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  advanceAnalysisPhase,
  analysisSummary,
  ANALYSIS_PROGRESS_FILE,
  CLAUDE_JSON_MAX_BYTES,
  createAnalysis,
  readAnalysis,
} from './analysis';
import { loadPoints, PointsValidationError, validatePoints } from './analysis-points';
import { ensureSourceCopies, SOURCE_COPIES_MAX } from './analysis-sources';
import type { ChatKnowledge } from './chat-types';
import { buildChatSettings } from './claude-chat';
import { assertSafeArgs, workFilesOf } from './claude';
import { createAnalysisProjectStore } from './project-store';
import { buildNotesMessage, cleanNotePath } from './referenced-notes';
import type { StoryStore } from './story-store';
import { tempRoot } from './test-support';
import { workDirFor } from './workdir';

const ANALYSIS = 'an-3';
const STORY = 'AQ-45';
const WORK_DIR = workDirFor(path.join(os.tmpdir(), 'jm-proyecto-de-prueba'));
const WORK_ROOT = path.dirname(WORK_DIR);
const LOCAL_KB: ChatKnowledge = { type: 'local', root: 'C:\\vault', adrDir: 'C:/vault/Proyectos/06-JM-ADR' };
const MCP_KB: ChatKnowledge = { type: 'mcp' };
const NOW = new Date('2026-11-09T15:00:00.000Z');
const READ_TOOLS = 'Read,Grep,Glob,Task,Agent';

test('las copias de fuentes de un análisis van en adjuntos/analisis/<id>, aparte de las de historias', () => {
  assert.equal(workFilesOf(WORK_DIR, ANALYSIS).attachments, path.join(WORK_DIR, 'adjuntos', 'analisis', ANALYSIS));
  assert.equal(workFilesOf(WORK_DIR, STORY).attachments, path.join(WORK_DIR, 'adjuntos', STORY));
  assert.doesNotThrow(() => assertSafeArgs(['--add-dir', workFilesOf(WORK_DIR, STORY).attachments], WORK_ROOT));
  assert.doesNotThrow(() => assertSafeArgs(['--add-dir', workFilesOf(WORK_DIR, ANALYSIS).attachments], WORK_ROOT));
  // La carpeta plana adjuntos/an-3 chocaría con AN-3 en NTFS: ya no se admite
  for (const bad of [
    path.join(WORK_DIR, 'adjuntos', ANALYSIS),
    path.join(WORK_DIR, 'adjuntos', 'analisis', STORY),
    path.join(WORK_DIR, 'adjuntos', 'analisis'),
    path.join(WORK_DIR, 'adjuntos', 'analisis', ANALYSIS, 'x'),
    path.join(WORK_DIR, 'adjuntos', 'otra', ANALYSIS),
  ]) {
    assert.throws(() => assertSafeArgs(['--add-dir', bad], WORK_ROOT), /no permitido/, bad);
  }
});

test('Write y Edit de un análisis deben apuntar al mismo id', () => {
  assert.doesNotThrow(() => assertSafeArgs([`${READ_TOOLS},Write(.jm/analisis/an-3/**),Edit(.jm/analisis/an-3/**)`]));
  assert.throws(
    () => assertSafeArgs([`${READ_TOOLS},Write(.jm/analisis/an-3/**),Edit(.jm/analisis/an-4/**)`]),
    /no permitido/,
  );
  assert.throws(
    () => assertSafeArgs([`${READ_TOOLS},Write(.jm/analisis/an-12/**),Edit(.jm/analisis/an-1/**)`]),
    /no permitido/,
  );
});

test('Claude no puede escribir estado.json ni fuentes/ del análisis: reglas deny en base local y en .jm', () => {
  const denied = (key: string, kb: ChatKnowledge | null) =>
    (buildChatSettings(key, kb) as { permissions: { deny: string[] } }).permissions.deny.filter((rule) =>
      /^(Write|Edit)/.test(rule),
    );
  assert.deepEqual(denied(ANALYSIS, LOCAL_KB), [
    'Write(//c/vault/Proyectos/06-JM-ADR/analisis/an-3/estado.json)',
    'Write(//c/vault/Proyectos/06-JM-ADR/analisis/an-3/fuentes/**)',
    'Edit(//c/vault/Proyectos/06-JM-ADR/analisis/an-3/estado.json)',
    'Edit(//c/vault/Proyectos/06-JM-ADR/analisis/an-3/fuentes/**)',
  ]);
  assert.deepEqual(denied(ANALYSIS, null), [
    'Write(.jm/analisis/an-3/estado.json)',
    'Write(.jm/analisis/an-3/fuentes/**)',
    'Edit(.jm/analisis/an-3/estado.json)',
    'Edit(.jm/analisis/an-3/fuentes/**)',
  ]);
  // Con MCP lo impone el intermediario; las historias no cambian
  assert.deepEqual(denied(ANALYSIS, MCP_KB), []);
  assert.deepEqual(denied(STORY, LOCAL_KB), []);
  assert.deepEqual(denied(STORY, null), []);
});

async function analysisWith(files: Record<string, string>) {
  const root = await tempRoot();
  const store = createAnalysisProjectStore(root, 'an-1');
  await createAnalysis(store, 'an-1', 'Obs', 'AQ', NOW);
  for (const [name, content] of Object.entries(files)) await store.writeText(name, content);
  return store;
}

test('fase.json: la fase solo avanza, el bloque sale de la lista y lo inválido se ignora', async () => {
  const store = await analysisWith({
    [ANALYSIS_PROGRESS_FILE]: JSON.stringify({ phase: 'documented', block: 'estimation', extra: 'x' }),
  });
  const state = await readAnalysis(store, 'an-1');
  assert.equal(state?.phase, 'documented');
  assert.equal(state?.block, 'estimation');

  await store.writeText(ANALYSIS_PROGRESS_FILE, JSON.stringify({ phase: 'hack', block: 'otro' }));
  const invalid = await readAnalysis(store, 'an-1');
  assert.equal(invalid?.phase, 'sources');
  assert.equal(invalid?.block, null);

  await advanceAnalysisPhase(store, 'an-1', 'debate');
  await store.writeText(ANALYSIS_PROGRESS_FILE, JSON.stringify({ phase: 'sources', block: 'points' }));
  const back = await readAnalysis(store, 'an-1');
  assert.equal(back?.phase, 'debate', 'fase.json no hace retroceder la fase');
  assert.equal(back?.block, 'points');
});

test('fase.json roto, no objeto o enorme se ignora; estado.json sigue siendo el respaldo', async () => {
  const store = await analysisWith({ [ANALYSIS_PROGRESS_FILE]: '{ roto' });
  assert.equal((await readAnalysis(store, 'an-1'))?.phase, 'sources');
  await store.writeText(ANALYSIS_PROGRESS_FILE, '[1,2]');
  assert.equal((await readAnalysis(store, 'an-1'))?.phase, 'sources');
  const huge = JSON.stringify({ phase: 'documented', pad: 'x'.repeat(CLAUDE_JSON_MAX_BYTES) });
  await store.writeText(ANALYSIS_PROGRESS_FILE, huge);
  assert.equal((await readAnalysis(store, 'an-1'))?.phase, 'sources', 'pasa del tope: se ignora');
  // Migración: lo que Claude escribió antes en estado.json se lee como respaldo
  const raw = JSON.parse((await store.readText('estado.json')) as string) as Record<string, unknown>;
  await store.writeText('estado.json', JSON.stringify({ ...raw, phase: 'debate', block: 'analysis' }));
  await store.writeText(ANALYSIS_PROGRESS_FILE, '{ roto');
  const migrated = await readAnalysis(store, 'an-1');
  assert.equal(migrated?.phase, 'debate');
  assert.equal(migrated?.block, 'analysis');
});

test('puntos.json por encima del tope se rechaza con un error claro', async () => {
  const pad = 'x'.repeat(CLAUDE_JSON_MAX_BYTES);
  const store = await analysisWith({ 'puntos.json': JSON.stringify({ points: [], pad }) });
  await assert.rejects(() => loadPoints(store), PointsValidationError);
});

test('un punto fuera de alcance acepta estimate null igual que sin estimate', () => {
  const base = {
    id: 'P1',
    title: 't',
    analysis: 'a',
    proposal: 'p',
    risk: 'low',
  };
  const points = validatePoints({ points: [{ ...base, outOfScope: true, estimate: null }] });
  assert.equal(points[0].estimate, null);
  assert.throws(() => validatePoints({ points: [{ ...base, outOfScope: false, estimate: null }] }), /estimate/);
});

test('un punto fuera de alcance puede venir sin riesgo ni estimación; uno en alcance no', () => {
  const base = { id: 'P5', title: 't', analysis: 'a', proposal: 'p' };
  const points = validatePoints({ points: [{ id: 'P5', title: 't', outOfScope: true, proposal: '' }] });
  assert.equal(points[0].risk, null);
  assert.equal(points[0].proposal, '');
  assert.equal(points[0].estimate, null);
  assert.throws(
    () => validatePoints({ points: [{ ...base, outOfScope: false, estimate: { optimistic: '1h', likely: '2h', pessimistic: '3h' } }] }),
    /risk/,
  );
});

test('el resumen del análisis muestra el bloque real cuando lo hay', async () => {
  const withBlock = await analysisWith({
    [ANALYSIS_PROGRESS_FILE]: JSON.stringify({ phase: 'debate', block: 'proposal' }),
  });
  assert.equal(analysisSummary((await readAnalysis(withBlock, 'an-1'))!).block, 'propuesta');
  const without = await analysisWith({});
  assert.equal(analysisSummary((await readAnalysis(without, 'an-1'))!).block, '—');
});

test('las notas con dos puntos o comillas invertidas se rechazan y el mensaje las cita', () => {
  for (const bad of ['a:b.md', 'a/b:c.md', 'x`y.md', 'ads:stream.md']) assert.equal(cleanNotePath(bad), null, bad);
  assert.equal(buildNotesMessage(['Proyectos/a.md'], LOCAL_KB).split('\n')[1], '- `C:/vault/Proyectos/a.md`');
  assert.equal(buildNotesMessage(['Proyectos/a.md'], MCP_KB).split('\n')[1], '- `Proyectos/a.md`');
});

test('ensureSourceCopies copia solo binarios de la bóveda, en adjuntos/analisis/<id>, con tope de cantidad', async () => {
  const entries = [
    ...Array.from({ length: SOURCE_COPIES_MAX + 20 }, (_, i) => ({ name: `f${i}.png`, isFile: true })),
    { name: 'nota.md', isFile: true },
  ];
  const reads: string[] = [];
  const store = {
    kind: 'vault',
    list: async () => entries,
    readBinary: async (name: string) => {
      reads.push(name);
      return Buffer.from([1]);
    },
  } as unknown as StoryStore;
  const workDir = path.join(await tempRoot(), 'work');
  await ensureSourceCopies(store, workDir, 'an-1');
  assert.equal(reads.length, SOURCE_COPIES_MAX);
  assert.ok(reads.every((name) => name.endsWith('.png')));
  assert.ok(fs.existsSync(path.join(workDir, 'adjuntos', 'analisis', 'an-1', 'f0.png')));
  assert.ok(!fs.existsSync(path.join(workDir, 'adjuntos', 'an-1')));
});
