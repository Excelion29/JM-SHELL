import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  buildChatArgs,
  buildChatSettings,
  ChatEvent,
  ChatProcess,
  ChatSession,
  ChatSpawner,
  createNdjsonParser,
  EXPLORER_AGENTS,
  MODELS,
} from './claude-chat';
import {
  appendTranscript,
  readTranscript,
  recordTurnUsage,
  TRANSCRIPT_MAX_BYTES,
  TRANSCRIPT_MAX_ENTRIES,
  writeAgentsFile,
  writeClaudeSettings,
  writeSkillCopy,
} from './chat-store';
import { assertSafeArgs, CHAT_FILES } from './claude';
import { stripTerminalControls } from './text';
import { ensureStory, readState } from './state';
import { addTurnUsage, contextTokensOf, exceedsSoftLimit, SESSION_TOKEN_SOFT_LIMIT } from './usage';

const SESSION = '123e4567-e89b-12d3-a456-426614174000';
const OTHER_SESSION = '223e4567-e89b-12d3-a456-426614174000';
const SKILL = CHAT_FILES.skill;
const AGENTS = CHAT_FILES.agents;
const SETTINGS = CHAT_FILES.settings;

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: 0.25,
  usage: { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
};

function parseAll(chunks: string[]): ChatEvent[] {
  const events: ChatEvent[] = [];
  const parser = createNdjsonParser((event) => events.push(event));
  chunks.forEach((chunk) => parser.push(chunk));
  parser.flush();
  return events;
}

test('el parser junta fragmentos partidos y reconoce todos los tipos de evento', () => {
  const text = [
    line({ type: 'system', subtype: 'init' }),
    line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ho' } } }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hola' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
          { type: 'tool_use', name: 'Agent', input: { subagent_type: 'explorador', description: 'x' } },
        ],
      },
    }),
    line({ type: 'user', message: { content: [] } }),
    line(RESULT),
  ].join('');
  const cut = Math.floor(text.length / 3);
  const events = parseAll([text.slice(0, cut), text.slice(cut, cut * 2), text.slice(cut * 2)]);
  assert.deepEqual(
    events.map((e) => e.type),
    ['textDelta', 'assistantText', 'toolActivity', 'toolActivity', 'turnEnd'],
  );
  assert.deepEqual(events[2], { type: 'toolActivity', tool: 'Read', target: 'src/a.ts' });
  assert.deepEqual(events[3], { type: 'toolActivity', tool: 'Agent', target: 'explorador' });
  assert.deepEqual(events[4], {
    type: 'turnEnd',
    usage: { inputTokens: 3, outputTokens: 40, cacheReadTokens: 1000, cacheCreationTokens: 200 },
    costUsd: 0.25,
    isError: false,
  });
});

test('el parser descarta líneas que no son JSON y las cuenta sin imprimirlas', () => {
  const events: ChatEvent[] = [];
  const parser = createNdjsonParser((event) => events.push(event));
  parser.push(`basura\n{roto\n${line(RESULT)}`);
  parser.flush();
  assert.equal(events.length, 1);
  assert.equal(parser.ignoredLines, 2);
});

test('el parser ignora texto y deltas de subagentes, y marca el error del resultado', () => {
  const events = parseAll([
    line({
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { content: [{ type: 'text', text: 'interno' }] },
    }),
    line({
      type: 'stream_event',
      parent_tool_use_id: 'toolu_1',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    }),
    line({ ...RESULT, subtype: 'error_during_execution', is_error: true }),
  ]);
  assert.deepEqual(
    events.map((e) => e.type),
    ['turnEnd'],
  );
  assert.equal((events[0] as Extract<ChatEvent, { type: 'turnEnd' }>).isError, true);
});

test('buildChatArgs genera flags fijas y rechaza clave, modelo o sesión inválidos', () => {
  const base = {
    key: 'AQ-45',
    model: MODELS.conversation,
    sessionId: SESSION,
    resume: false,
    skillFile: SKILL,
    agentsFile: AGENTS,
    settingsFile: SETTINGS,
  };
  const args = buildChatArgs(base);
  assert.doesNotThrow(() => assertSafeArgs(args));
  assert.ok(args.includes('Read,Grep,Glob,Task,Agent,Write(.jm/historias/AQ-45/**),Edit(.jm/historias/AQ-45/**)'));
  assert.deepEqual(args.slice(-2), ['--session-id', SESSION]);
  assert.deepEqual(buildChatArgs({ ...base, resume: true }).slice(-2), ['--resume', SESSION]);
  assert.throws(() => buildChatArgs({ ...base, key: 'AQ-1/../x' }), /inválida/);
  assert.throws(() => buildChatArgs({ ...base, key: 'AQ-1**),Bash(*' }), /inválida/);
  assert.throws(() => buildChatArgs({ ...base, model: 'gpt' as never }), /no permitido/i);
  assert.throws(() => buildChatArgs({ ...base, sessionId: 'x" & calc' }), /inválido/);
});

test('assertSafeArgs rechaza un allowedTools con otra clave o herramientas extra y rutas con metacaracteres', () => {
  assert.throws(() => assertSafeArgs(['Read,Grep,Glob,Task,Agent,Bash(*)']), /no permitido/);
  assert.throws(
    () => assertSafeArgs(['Read,Grep,Glob,Task,Agent,Write(.jm/historias/AQ-1/**),Edit(.jm/historias/x&y/**)']),
    /no permitido/,
  );
  assert.throws(() => assertSafeArgs(['C:\\a & calc.md']), /no permitido/);
  assert.throws(() => assertSafeArgs(['C:\\a\\..\\b.md']), /no permitido/);
  assert.throws(() => assertSafeArgs(['--dangerously-skip-permissions']), /no permitido/);
});

test('el subagente explorador usa Haiku y solo herramientas de lectura', () => {
  assert.equal(EXPLORER_AGENTS.explorador.model, 'haiku');
  assert.deepEqual(EXPLORER_AGENTS.explorador.tools, ['Read', 'Grep', 'Glob']);
});

interface FakeProc extends ChatProcess {
  args: string[];
  written: string[];
  stderr: (data: string) => void;
  ended: boolean;
  killed: boolean;
  failWrite: boolean;
  fail: (error: Error) => void;
  emit: (data: string) => void;
  exit: (code: number | null) => void;
}

function harness(clock = { now: 0 }, failWrites = false, save?: (id: string) => Promise<void>) {
  const procs: FakeProc[] = [];
  const saved: string[] = [];
  const events: ChatEvent[] = [];
  const ids = [SESSION, OTHER_SESSION];
  const spawner: ChatSpawner = (args) => {
    let onData: (chunk: string) => void = () => undefined;
    let onExit: (code: number | null) => void = () => undefined;
    let onError: (error: Error) => void = () => undefined;
    let onStderr: (chunk: string) => void = () => undefined;
    const proc: FakeProc = {
      args,
      written: [],
      stderr: (data) => onStderr(data),
      ended: false,
      killed: false,
      failWrite: failWrites,
      fail: (error) => onError(error),
      write: (text) => {
        if (proc.failWrite) throw new Error('EPIPE');
        proc.written.push(text);
      },
      end: () => void (proc.ended = true),
      kill: () => void (proc.killed = true),
      onData: (listener) => void (onData = listener),
      onStderr: (listener) => void (onStderr = listener),
      onExit: (listener) => void (onExit = listener),
      onError: (listener) => void (onError = listener),
      emit: (data) => onData(data),
      exit: (code) => onExit(code),
    };
    procs.push(proc);
    return proc;
  };
  const session = new ChatSession({
    root: 'C:\\proj',
    skillFile: SKILL,
    agentsFile: AGENTS,
    settingsFile: SETTINGS,
    spawner,
    saveSessionId: (id) => {
      saved.push(id);
      return save?.(id);
    },
    newSessionId: () => ids.shift() ?? 'x',
    now: () => clock.now,
  });
  session.onEvent((event) => events.push(event));
  return { session, procs, saved, events, clock };
}

const userText = (written: string) => JSON.parse(written).message.content as string;

test('sesión nueva: guarda el id y escribe el primer mensaje como línea JSON por stdin', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: null, model: 'sonnet' });
  assert.deepEqual(h.saved, [SESSION]);
  assert.ok(h.procs[0].args.includes('--session-id'));
  const first = JSON.parse(h.procs[0].written[0]);
  assert.equal(first.type, 'user');
  assert.equal(first.message.role, 'user');
  assert.match(first.message.content, /skill refinar.*AQ-45/);
  assert.ok(h.procs[0].written[0].endsWith('\n'));
});

test('send escribe el texto solo por stdin: nunca aparece en los argumentos', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: null, model: 'sonnet' });
  const secret = 'texto con "comillas" & %PATH% y | pipes';
  h.session.send(secret);
  assert.equal(userText(h.procs[0].written[1]), secret);
  assert.ok(h.procs[0].args.every((arg) => !arg.includes('PATH')));
});

// Abre una conversación ya empezada y manda el primer mensaje del dev (lanza el proceso con --resume)
async function reopened(h: ReturnType<typeof harness>, text = 'sigamos') {
  await h.session.start({ key: 'AQ-45', sessionId: SESSION, model: 'sonnet' });
  h.session.send(text);
}

test('sesión guardada: al reabrir no lanza proceso ni envía nada hasta que el dev escribe', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: SESSION, model: 'sonnet' });
  assert.equal(h.procs.length, 0);
  assert.equal(h.session.isBusy, false);
  assert.deepEqual(h.saved, []);
});

test('el primer mensaje del dev retoma con --resume y se entrega tal cual', async () => {
  const h = harness();
  await reopened(h, 'qué decidimos');
  assert.equal(h.procs.length, 1);
  assert.deepEqual(h.procs[0].args.slice(-2), ['--resume', SESSION]);
  assert.deepEqual(h.procs[0].written.map(userText), ['qué decidimos']);
  assert.equal(h.session.isBusy, true);
  assert.deepEqual(h.saved, []);
});

test('con historial y sin sesión guardada, el primer mensaje abre una sesión nueva con la recuperación', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: null, model: 'sonnet', hasHistory: true });
  assert.equal(h.procs.length, 0);
  h.session.send('hola');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.saved, [SESSION]);
  assert.ok(h.procs[0].args.includes('--session-id'));
  assert.match(userText(h.procs[0].written[0]), /bitacora\.md[\s\S]*hola$/);
});

test('cambiar de modelo antes del primer mensaje no lanza proceso y se aplica al retomar', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: SESSION, model: 'sonnet' });
  h.session.switchModel('opus');
  assert.equal(h.procs.length, 0);
  h.session.send('hola');
  assert.equal(h.procs[0].args[h.procs[0].args.indexOf('--model') + 1], 'opus');
});

test('switchModel retoma la misma sesión con --model opus y vuelve con otro switch', async () => {
  const h = harness();
  await reopened(h);
  h.procs[0].emit(line(RESULT));
  h.session.switchModel('opus');
  assert.ok(h.procs[0].killed);
  const args = h.procs[1].args;
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
  assert.deepEqual(args.slice(-2), ['--resume', SESSION]);
  assert.equal(h.procs[1].written.length, 0);
  h.procs[1].emit(line(RESULT));
  h.session.switchModel('sonnet');
  assert.equal(h.procs[2].args[h.procs[2].args.indexOf('--model') + 1], 'sonnet');
});

test('switchModel con una respuesta en curso no corta el proceso y avisa', async () => {
  const h = harness();
  await reopened(h);
  h.session.switchModel('opus');
  assert.equal(h.procs.length, 1);
  assert.equal(h.events.at(-1)?.type, 'error');
});

test('si --resume falla al instante abre una sesión nueva con la recuperación y el texto del dev', async () => {
  const resumed = harness();
  await reopened(resumed, 'continúa');
  resumed.clock.now = 100;
  resumed.procs[0].stderr(`No conversation found with session ID: ${SESSION}
`);
  resumed.procs[0].exit(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resumed.procs.length, 2);
  assert.deepEqual(resumed.saved, [SESSION]);
  assert.ok(resumed.procs[1].args.includes('--session-id'));
  assert.match(userText(resumed.procs[1].written[0]), /bitacora\.md[\s\S]*continúa$/);
  assert.ok(!resumed.events.some((e) => e.type === 'exit'));
});

test('con el result de error que emite el CLI real ante una sesión inexistente también abre una sesión nueva', async () => {
  const h = harness();
  await reopened(h, 'continúa');
  h.clock.now = 100;
  h.procs[0].emit(
    line({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: {},
    }),
  );
  h.procs[0].stderr(`No conversation found with session ID: ${SESSION}\n`);
  h.procs[0].exit(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.procs.length, 2);
  assert.ok(h.procs[1].args.includes('--session-id'));
  assert.match(userText(h.procs[1].written[0]), /continúa$/);
  assert.ok(!h.events.some((e) => e.type === 'turnEnd' || e.type === 'exit'));
});

test('un error a mitad de vuelta con salida parcial no abre otra sesión y conserva el id', async () => {
  const h = harness();
  await reopened(h, 'continúa');
  h.procs[0].emit(
    line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ho' } } }),
  );
  h.procs[0].stderr('No conversation found with session ID\n');
  h.procs[0].exit(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.procs.length, 1);
  assert.deepEqual(h.saved, []);
  assert.equal(h.session.currentSessionId, SESSION);
  assert.ok(h.events.some((e) => e.type === 'error'));
});

test('si --resume falla sin salida pero el stderr no es de sesión inexistente, no abre otra sesión', async () => {
  const h = harness();
  await reopened(h, 'continúa');
  h.procs[0].stderr('rate limit exceeded\n');
  h.procs[0].exit(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.procs.length, 1);
  assert.equal(h.session.currentSessionId, SESSION);
  assert.ok(h.events.some((e) => e.type === 'error'));
});

test('cerrar durante el guardado del id no lanza ningún proceso', async () => {
  let release: () => void = () => undefined;
  const h = harness({ now: 0 }, false, () => new Promise<void>((resolve) => void (release = resolve)));
  const starting = h.session.start({ key: 'AQ-45', sessionId: null, model: 'sonnet' });
  h.session.close(true);
  release();
  await starting;
  assert.equal(h.procs.length, 0);
});

test('si el proceso con --resume ya respondió, la salida con error no abre otra sesión', async () => {
  const h = harness();
  await reopened(h);
  h.procs[0].emit(line(RESULT));
  h.procs[0].exit(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.procs.length, 1);
  assert.equal(h.events.at(-1)?.type, 'exit');
});

test('startFromLog tras reabrir sin mensajes abre una sesión nueva y anula la espera', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: SESSION, model: 'sonnet' });
  await h.session.startFromLog();
  assert.equal(h.procs.length, 1);
  assert.ok(h.procs[0].args.includes('--session-id'));
  h.session.send('hola');
  assert.equal(h.procs.length, 1);
  assert.equal(userText(h.procs[0].written[1]), 'hola');
});

test('startFromLog abre una sesión con otro uuid y cierra la anterior', async () => {
  const h = harness();
  await h.session.start({ key: 'AQ-45', sessionId: null, model: 'sonnet' });
  await h.session.startFromLog();
  assert.ok(h.procs[0].killed);
  assert.deepEqual(h.saved, [SESSION, OTHER_SESSION]);
  assert.match(userText(h.procs[1].written[0]), /bitacora\.md/);
});

test('close sin forzar cierra stdin y deja terminar; forzado corta el proceso', async () => {
  const h = harness();
  await reopened(h);
  h.session.close();
  assert.ok(h.procs[0].ended);
  assert.ok(!h.procs[0].killed);
  const forced = harness();
  await reopened(forced);
  forced.session.close(true);
  assert.ok(forced.procs[0].killed);
});

test('los eventos de un proceso reemplazado ya no llegan', async () => {
  const h = harness();
  await reopened(h);
  h.procs[0].emit(line(RESULT));
  h.session.switchModel('opus');
  const before = h.events.length;
  h.procs[0].emit(line(RESULT));
  h.procs[0].exit(0);
  assert.equal(h.events.length, before);
});

test('el uso se acumula por vuelta y el límite blando se dispara con el contexto', () => {
  const turn = { inputTokens: 3, outputTokens: 40, cacheReadTokens: 1000, cacheCreationTokens: 200 };
  const once = addTurnUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 }, turn, 0.25);
  const twice = addTurnUsage(once, turn, 0.25);
  assert.deepEqual(twice, { inputTokens: 406, outputTokens: 80, cacheReadTokens: 2000, costUsd: 0.5, turns: 2 });
  assert.equal(contextTokensOf(turn), 1203);
  assert.equal(exceedsSoftLimit(SESSION_TOKEN_SOFT_LIMIT - 1), false);
  assert.equal(exceedsSoftLimit(SESSION_TOKEN_SOFT_LIMIT), true);
});

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jm-chat-'));
}

test('recordTurnUsage suma en estado.json', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const turn = { inputTokens: 3, outputTokens: 40, cacheReadTokens: 1000, cacheCreationTokens: 200 };
  await recordTurnUsage(root, 'AQ-45', turn, 0.25);
  await recordTurnUsage(root, 'AQ-45', turn, 0.25);
  assert.deepEqual((await readState(root, 'AQ-45'))?.usage, {
    inputTokens: 406,
    outputTokens: 80,
    cacheReadTokens: 2000,
    costUsd: 0.5,
    turns: 2,
  });
});

test('la copia local guarda los turnos, devuelve los últimos N y tolera líneas rotas', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  for (let i = 0; i < 5; i += 1) {
    await appendTranscript(root, 'AQ-45', { role: i % 2 ? 'assistant' : 'user', text: `m${i}`, at: `t${i}` });
  }
  assert.deepEqual(
    (await readTranscript(root, 'AQ-45', 2)).map((l) => l.text),
    ['m3', 'm4'],
  );
  const file = path.join(root, '.jm', 'historias', 'AQ-45', '.chat.jsonl');
  await fs.appendFile(file, '{cortada');
  assert.equal((await readTranscript(root, 'AQ-45', 10)).length, 5);
});

test('la copia local se acota a las últimas entradas', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = path.join(root, '.jm', 'historias', 'AQ-45', '.chat.jsonl');
  const old = Array.from({ length: TRANSCRIPT_MAX_ENTRIES }, (_, i) =>
    JSON.stringify({ role: 'user', text: `v${i}`, at: 't' }),
  );
  await fs.writeFile(file, `${old.join('\n')}\n`);
  await appendTranscript(root, 'AQ-45', { role: 'assistant', text: 'nuevo', at: 't' });
  const all = await readTranscript(root, 'AQ-45', TRANSCRIPT_MAX_ENTRIES + 10);
  assert.equal(all.length, TRANSCRIPT_MAX_ENTRIES);
  assert.equal(all[0].text, 'v1');
  assert.equal(all.at(-1)?.text, 'nuevo');
});

test('buildChatArgs excluye ajustes de usuario/proyecto, pasa los ajustes de jm y niega herramientas', () => {
  const args = buildChatArgs({
    key: 'AQ-45',
    model: 'sonnet',
    sessionId: SESSION,
    resume: false,
    skillFile: SKILL,
    agentsFile: AGENTS,
    settingsFile: SETTINGS,
  });
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.equal(args[args.indexOf('--settings') + 1], SETTINGS);
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Bash,WebFetch,WebSearch,NotebookEdit');
  assert.doesNotThrow(() => assertSafeArgs(args));
  assert.throws(() => assertSafeArgs(['--disallowedTools', 'Bash,WebFetch']), /no permitido/);
});

test('los ajustes de jm desactivan hooks y espejan el allowlist y las negaciones', () => {
  const settings = buildChatSettings('AQ-45') as {
    disableAllHooks: boolean;
    permissions: { allow: string[]; deny: string[] };
  };
  assert.equal(settings.disableAllHooks, true);
  assert.ok(settings.permissions.allow.includes('Write(.jm/historias/AQ-45/**)'));
  assert.ok(!settings.permissions.allow.some((rule) => rule.startsWith('Bash')));
  assert.deepEqual(settings.permissions.deny, ['Bash', 'WebFetch', 'WebSearch', 'NotebookEdit']);
  assert.throws(() => buildChatSettings('AQ-1/../x'), /inválida/);
});

test('un EPIPE al escribir no tumba la app: avisa y limpia el estado', async () => {
  const h = harness();
  await reopened(h);
  h.procs[0].emit(line(RESULT));
  h.procs[0].failWrite = true;
  assert.throws(() => h.session.send('hola'), /No pude enviar/);
  assert.equal(h.session.isBusy, false);
});

test('un error asíncrono del proceso (stdin cerrado) se informa como error y corta el hijo', async () => {
  const h = harness();
  await reopened(h);
  h.procs[0].fail(new Error('write EPIPE'));
  assert.ok(h.procs[0].killed);
  assert.equal(h.events.at(-1)?.type, 'error');
  assert.throws(() => h.session.send('otra'), /no está abierta/);
});

test('si el primer mensaje no se puede escribir, se informa en vez de lanzar', async () => {
  const h = harness({ now: 0 }, true);
  await h.session.start({ key: 'AQ-45', sessionId: null, model: 'sonnet' });
  assert.equal(h.events.at(-1)?.type, 'error');
  assert.ok(h.procs[0].killed);
});

test('el costo acumulado por proceso se registra como diferencia entre vueltas', async () => {
  const h = harness();
  await reopened(h);
  h.procs[0].emit(line({ ...RESULT, total_cost_usd: 0.1 }));
  h.procs[0].emit(line({ ...RESULT, total_cost_usd: 0.25 }));
  const costs = h.events
    .filter((e) => e.type === 'turnEnd')
    .map((e) => (e as Extract<ChatEvent, { type: 'turnEnd' }>).costUsd);
  assert.equal(costs.length, 2);
  assert.ok(Math.abs(costs[0] - 0.1) < 1e-9);
  assert.ok(Math.abs(costs[1] - 0.15) < 1e-9);
  h.session.switchModel('opus');
  h.procs[1].emit(line({ ...RESULT, total_cost_usd: 0.05 }));
  const last = h.events.filter((e) => e.type === 'turnEnd').at(-1) as Extract<ChatEvent, { type: 'turnEnd' }>;
  assert.ok(Math.abs(last.costUsd - 0.05) < 1e-9);
});

test('una línea sin salto de línea gigante se descarta con un error y el parser sigue', () => {
  const events: ChatEvent[] = [];
  const parser = createNdjsonParser((event) => events.push(event));
  const chunk = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < 9; i += 1) parser.push(chunk);
  assert.equal(events.at(-1)?.type, 'error');
  parser.push(`${JSON.stringify(RESULT)}${String.fromCharCode(10)}`);
  assert.equal(events.at(-1)?.type, 'turnEnd');
});

test('readTranscript lee solo la cola de un archivo enorme', async () => {
  const root = await tempRoot();
  await ensureStory(root, 'AQ-45', 'Login', null);
  const file = path.join(root, '.jm', 'historias', 'AQ-45', '.chat.jsonl');
  const filler = JSON.stringify({ role: 'user', text: 'x'.repeat(1000), at: 't' });
  const lines = Array.from({ length: TRANSCRIPT_MAX_BYTES / 1000 + 200 }, () => filler);
  lines.push(JSON.stringify({ role: 'assistant', text: 'final', at: 't' }));
  await fs.writeFile(file, `${lines.join(String.fromCharCode(10))}${String.fromCharCode(10)}`);
  const result = await readTranscript(root, 'AQ-45', 3);
  assert.equal(result.at(-1)?.text, 'final');
  assert.equal(result.length, 3);
});

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('stripTerminalControls quita CSI, OSC 8, OSC 52 y BEL pero conserva saltos de línea y tabulaciones', () => {
  const dirty = `a${ESC}[2Jb${ESC}]8;;http://x.y${BEL}link${ESC}]8;;${BEL}\n${ESC}]52;c;AAAA${BEL}c\td${BEL}${ESC}Pdcs${ESC}\e`;
  assert.equal(stripTerminalControls(dirty), 'ablink\nc\tde');
});

test('el texto del asistente (completo y en deltas) llega a la app sin secuencias de escape', () => {
  const events = parseAll([
    line({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: `hola ${ESC}[2J${ESC}]52;c;QQ${BEL}mundo` },
      },
    }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: `${ESC}[31mrojo${ESC}[0m${BEL}\nfin` }] } }),
  ]);
  assert.deepEqual(events, [
    { type: 'textDelta', text: 'hola mundo' },
    { type: 'assistantText', text: 'rojo\nfin' },
  ]);
});

test('el historial leído de disco conserva los saltos de línea y no trae escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-hist-'));
  await ensureStory(root, 'AQ-45', 'Login', null);
  await appendTranscript(root, 'AQ-45', { role: 'assistant', text: `uno\ndos${ESC}[2J`, at: 't' });
  assert.equal((await readTranscript(root, 'AQ-45', 5))[0].text, 'uno\ndos');
});

test('una raíz con tildes y paréntesis funciona: los archivos de jm viajan relativos al cwd', async () => {
  const root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'jm-root-')), 'José (v2)');
  await fs.ensureDir(root);
  const skill = path.join(root, 'origen.md');
  await fs.writeFile(skill, '# skill');
  writeAgentsFile(root);
  writeClaudeSettings(root, 'AQ-45');
  writeSkillCopy(root, skill);
  for (const file of Object.values(CHAT_FILES)) assert.ok(await fs.pathExists(path.join(root, file)), file);
  const args = buildChatArgs({
    key: 'AQ-45',
    model: 'sonnet',
    sessionId: SESSION,
    resume: false,
    skillFile: CHAT_FILES.skill,
    agentsFile: CHAT_FILES.agents,
    settingsFile: CHAT_FILES.settings,
  });
  assert.doesNotThrow(() => assertSafeArgs(args));
  assert.ok(args.every((arg) => !arg.includes('José') && !arg.includes('(v2)')));
});

test('una ruta absoluta de archivo ya no pasa el filtro de argumentos', () => {
  assert.throws(
    () => assertSafeArgs(['--settings', path.join('C:', 'José (v2)', '.jm', 'claude-settings.json')]),
    /no permitido/,
  );
  assert.throws(() => assertSafeArgs(['--settings', '.jm/../x.json']), /no permitido/);
});
