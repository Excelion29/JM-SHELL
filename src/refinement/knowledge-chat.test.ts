import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { writeKnowledgeContext, writeMcpConfig } from './chat-store';
import type { ChatKnowledge } from './chat-types';
import { buildChatArgs, buildChatSettings, ChatProcess, ChatSession, ChatSpawner } from './claude-chat';
import {
  assertSafeArgs,
  chatAllowedTools,
  CHAT_FILES,
  handoffKnowledgeArgs,
  isSafeAddDirPath,
  scopedKnowledgeRules,
  toRulePath,
} from './claude';
import { KB_ALLOWED_TOOLS } from './kb-proxy';

const SESSION = '123e4567-e89b-12d3-a456-426614174000';
const MCP: ChatKnowledge = { type: 'mcp' };
const LOCAL: ChatKnowledge = { type: 'local', root: 'C:\\notas', adrDir: 'C:/notas/PROY/00-JM-ADR' };
const BASE_INPUT = {
  key: 'AQ-45',
  model: 'sonnet',
  sessionId: SESSION,
  resume: false,
  skillFile: CHAT_FILES.skill,
  agentsFile: CHAT_FILES.agents,
  settingsFile: CHAT_FILES.settings,
} as const;

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('con MCP: --mcp-config apunta al archivo de jm y las herramientas permitidas son las de la lista', () => {
  const args = buildChatArgs({ ...BASE_INPUT, kb: MCP });
  assert.doesNotThrow(() => assertSafeArgs(args));
  assert.equal(valueAfter(args, '--mcp-config'), '.jm/mcp.json');
  const tools = valueAfter(args, '--allowedTools').split(',');
  for (const tool of KB_ALLOWED_TOOLS) assert.ok(tools.includes(`mcp__jm_kb__${tool}`), tool);
  assert.ok(!tools.some((tool) => /delete|move|copy|execute/.test(tool)));
  assert.ok(args.includes('--strict-mcp-config'));
});

test('con carpeta local: --add-dir y las reglas con ruta absoluta solo van en los ajustes', () => {
  const args = buildChatArgs({ ...BASE_INPUT, kb: LOCAL });
  assert.doesNotThrow(() => assertSafeArgs(args));
  assert.equal(valueAfter(args, '--add-dir'), 'C:\\notas');
  assert.ok(!valueAfter(args, '--allowedTools').includes('00-JM-ADR'));
  assert.ok(!args.includes('--mcp-config'));
  const rules = scopedKnowledgeRules(LOCAL);
  assert.deepEqual(rules, ['Write(//c/notas/PROY/00-JM-ADR/**)', 'Edit(//c/notas/PROY/00-JM-ADR/**)']);
  const settings = buildChatSettings('AQ-45', LOCAL) as { permissions: { allow: string[] } };
  assert.deepEqual(settings.permissions.allow, [...chatAllowedTools('AQ-45', LOCAL).split(','), ...rules]);
});

test('sin base los ajustes y los argumentos no cambian', () => {
  const args = buildChatArgs(BASE_INPUT);
  assert.ok(!args.includes('--mcp-config') && !args.includes('--add-dir'));
  const settings = buildChatSettings('AQ-45') as { permissions: { allow: string[] } };
  assert.deepEqual(settings.permissions.allow, chatAllowedTools('AQ-45').split(','));
  assert.deepEqual(scopedKnowledgeRules(MCP), []);
});

test('los ajustes con MCP espejan el allowlist de argv', () => {
  const settings = buildChatSettings('AQ-45', MCP) as { permissions: { allow: string[] } };
  assert.deepEqual(
    settings.permissions.allow,
    valueAfter(buildChatArgs({ ...BASE_INPUT, kb: MCP }), '--allowedTools').split(','),
  );
});

test('assertSafeArgs: la carpeta tras --add-dir debe ser absoluta y sin metacaracteres', () => {
  assert.doesNotThrow(() => assertSafeArgs(['--add-dir', 'C:\\Users\\José (v2)\\notas']));
  const bad = [
    'C:\\a%PATH%',
    'C:\\a"b',
    'C:\\a & calc',
    'C:\\a|b',
    'C:\\a\\..\\b',
    'relativa\\ruta',
    'C:\\notas\\',
    'C:\\a^b',
    'C:\\a!b',
    '\\\\servidor\\recurso',
    '\\\\?\\C:\\notas',
    '//servidor/recurso',
    '\\notas',
    'C:/notas',
    'C:\\notas\\.\\x',
  ];
  for (const path of bad) assert.throws(() => assertSafeArgs(['--add-dir', path]), /no permitido/, path);
  assert.throws(() => assertSafeArgs(['--settings', 'C:\\Users\\x\\s.json']), /no permitido/);
});

test('isSafeAddDirPath: Windows exige unidad y ruta normalizada; POSIX, ruta absoluta sin ..', () => {
  assert.ok(isSafeAddDirPath('C:\\Users\\José (v2)\\notas', true));
  assert.ok(!isSafeAddDirPath('/home/dev/notas', true));
  assert.ok(isSafeAddDirPath('/home/dev/notas', false));
  for (const bad of ['/home/../etc', '/home/./dev', '/home//dev', '/home/dev/', 'relativa', '/a & b']) {
    assert.ok(!isSafeAddDirPath(bad, false), bad);
  }
});

test('toRulePath emite la forma //c/... que Claude Code casa con rutas absolutas', () => {
  assert.equal(toRulePath('C:/Users/Delfos/KB/PROY/04-JM-ADR'), '//c/Users/Delfos/KB/PROY/04-JM-ADR');
  assert.equal(toRulePath('D:\\notas\\PROY'), '//d/notas/PROY');
  assert.equal(toRulePath('/home/dev/kb'), '//home/dev/kb');
  const kb: ChatKnowledge = {
    type: 'local',
    root: 'C:\\Users\\Delfos\\KB',
    adrDir: 'C:/Users/Delfos/KB/PROY/04-JM-ADR',
  };
  assert.deepEqual(scopedKnowledgeRules(kb), [
    'Write(//c/Users/Delfos/KB/PROY/04-JM-ADR/**)',
    'Edit(//c/Users/Delfos/KB/PROY/04-JM-ADR/**)',
  ]);
});

test('el arranque de Claude completo recibe las banderas de la base antes del prompt', () => {
  assert.deepEqual(handoffKnowledgeArgs(MCP).slice(0, 2), ['--mcp-config', '.jm/mcp.json']);
  assert.doesNotThrow(() =>
    assertSafeArgs([...handoffKnowledgeArgs(MCP), '--session-id', SESSION, '-n', 'refinar AQ-45', '/refinar AQ-45']),
  );
  assert.deepEqual(handoffKnowledgeArgs(LOCAL), ['--add-dir', 'C:\\notas']);
  assert.deepEqual(handoffKnowledgeArgs(null), []);
});

test('mcp.json apunta al intermediario local y no lleva key, cabeceras ni variables', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-mcp-'));
  writeMcpConfig(root, 'http://127.0.0.1:50123/mcp');
  const raw = await fs.readFile(path.join(root, '.jm', 'mcp.json'), 'utf8');
  assert.deepEqual(JSON.parse(raw), { mcpServers: { jm_kb: { type: 'http', url: 'http://127.0.0.1:50123/mcp' } } });
  assert.ok(!/authorization|bearer|\$\{/i.test(raw));
});

test('el contexto de la base se escribe y se borra cuando ya no hay base', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-ctx-'));
  const file = path.join(root, '.jm', 'knowledge-context.md');
  writeKnowledgeContext(root, 'Tu nota es X.');
  assert.equal(await fs.readFile(file, 'utf8'), 'Tu nota es X.\n');
  writeKnowledgeContext(root, null);
  assert.ok(!(await fs.pathExists(file)));
  assert.doesNotThrow(() => writeKnowledgeContext(root, null));
});

function messages(options: {
  kbContext: string | null;
  sessionId: string | null;
  startMessage?: 'first' | 'fromLog' | 'fromNote';
}) {
  const written: string[] = [];
  const spawner: ChatSpawner = () =>
    ({
      write: (line: string) =>
        void written.push((JSON.parse(line) as { message: { content: string } }).message.content),
      end: () => undefined,
      kill: () => undefined,
      onData: () => undefined,
      onStderr: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
    }) satisfies ChatProcess;
  const session = new ChatSession({
    root: 'C:\\proj',
    skillFile: CHAT_FILES.skill,
    agentsFile: CHAT_FILES.agents,
    settingsFile: CHAT_FILES.settings,
    kb: MCP,
    kbContext: options.kbContext,
    saveSessionId: () => undefined,
    newSessionId: () => SESSION,
    spawner,
  });
  return {
    written,
    send: (text: string) => session.send(text),
    start: () =>
      session.start({
        key: 'AQ-45',
        sessionId: options.sessionId,
        model: 'sonnet',
        startMessage: options.startMessage,
      }),
  };
}

const CONTEXT = 'Tu nota de esta historia es `P/00-JM-ADR/AQ-45.md`.';

test('los mensajes iniciales llevan el contexto de la base: primero, retoma y desde la nota', async () => {
  const first = messages({ kbContext: CONTEXT, sessionId: null });
  await first.start();
  assert.match(first.written[0], /skill refinar.*AQ-45.*00-JM-ADR/);
  const resumed = messages({ kbContext: CONTEXT, sessionId: SESSION });
  await resumed.start();
  assert.deepEqual(resumed.written, []);
  resumed.send('hola');
  assert.equal(resumed.written[0], `hola ${CONTEXT}`);
  const fromNote = messages({ kbContext: CONTEXT, sessionId: null, startMessage: 'fromNote' });
  await fromNote.start();
  assert.match(fromNote.written[0], /nota de esta historia: léela primero.*00-JM-ADR/);
  const fromLog = messages({ kbContext: CONTEXT, sessionId: null, startMessage: 'fromLog' });
  await fromLog.start();
  assert.match(fromLog.written[0], /bitacora\.md.*00-JM-ADR/);
});

test('sin contexto el mensaje inicial es el de siempre', async () => {
  const plain = messages({ kbContext: null, sessionId: null });
  await plain.start();
  assert.equal(plain.written[0], 'Sigue la skill refinar para la historia AQ-45.');
});
