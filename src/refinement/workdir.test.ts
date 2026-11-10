import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  writeAgentsFile,
  writeClaudeSettings,
  writeKnowledgeContext,
  writeMcpConfig,
  writeSkillCopy,
} from './chat-store';
import { writeTaskSettings } from './claude';
import { CHAT_FILES, isWorkHashSegment, workBase, workDirFor, writeReadOnlyCopy } from './workdir';

const temp = (prefix: string) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

test('la carpeta de trabajo cuelga de ~/.jira-tool/trabajo con un hash estable de la ruta real', async () => {
  const home = await temp('jm-home-');
  const root = await temp('jm-proj-');
  const dir = workDirFor(root, home);
  assert.equal(path.dirname(dir), workBase(home));
  assert.ok(isWorkHashSegment(path.basename(dir)));
  assert.equal(workDirFor(root, home), dir);
  assert.notEqual(workDirFor(await temp('jm-proj-'), home), dir);
  assert.ok(workBase(home).endsWith(path.join('.jira-tool', 'trabajo')));
});

test('los archivos técnicos van a la carpeta de trabajo, el repo queda limpio y mcp.json no lleva la key', async () => {
  const home = await temp('jm-home-');
  const root = await temp('jm-proj-');
  const workDir = workDirFor(root, home);
  const skill = path.join(await temp('jm-src-'), 'SKILL.md');
  await fs.writeFile(skill, '# skill');
  writeAgentsFile(workDir);
  writeClaudeSettings(workDir, 'AQ-45', { type: 'mcp' });
  writeSkillCopy(workDir, skill);
  writeSkillCopy(workDir, skill, CHAT_FILES.analysisSkill);
  writeMcpConfig(workDir, 'http://127.0.0.1:50123/mcp/abc');
  writeKnowledgeContext(workDir, 'contexto');
  writeTaskSettings(workDir);
  for (const file of Object.values(CHAT_FILES)) assert.ok(await fs.pathExists(path.join(workDir, file)), file);
  assert.deepEqual(await fs.readdir(root), [], 'el repositorio no recibe nada');
  const mcp = await fs.readFile(path.join(workDir, CHAT_FILES.mcp), 'utf8');
  assert.ok(!/authorization|bearer|api[-_ ]?key/i.test(mcp));
});

test('la copia de un adjunto de la bóveda queda de solo lectura y no se reescribe si ya está', async () => {
  const workDir = workDirFor(await temp('jm-proj-'), await temp('jm-home-'));
  const data = Buffer.from([1, 2, 3, 255]);
  const file = writeReadOnlyCopy(workDir, path.join('adjuntos', 'AQ-45'), '1-a.png', data);
  assert.deepEqual(await fs.readFile(file), data);
  assert.throws(() => fs.writeFileSync(file, 'x'), /EPERM|EACCES/);
  const stamp = fs.statSync(file).mtimeMs;
  writeReadOnlyCopy(workDir, path.join('adjuntos', 'AQ-45'), '1-a.png', data);
  assert.equal(fs.statSync(file).mtimeMs, stamp);
});

test('el contexto de la base se borra cuando ya no hay base', async () => {
  const workDir = workDirFor(await temp('jm-proj-'), await temp('jm-home-'));
  writeKnowledgeContext(workDir, 'hola');
  writeKnowledgeContext(workDir, null);
  assert.ok(!(await fs.pathExists(path.join(workDir, CHAT_FILES.context))));
});

test('la copia se rehace si el contenido cambió aunque el tamaño sea igual', async () => {
  const workDir = workDirFor(await temp('jm-proj-'), await temp('jm-home-'));
  const folder = path.join('adjuntos', 'AQ-45');
  const file = writeReadOnlyCopy(workDir, folder, '1-a.png', Buffer.from([1, 2, 3]));
  writeReadOnlyCopy(workDir, folder, '1-a.png', Buffer.from([9, 9, 9]));
  assert.deepEqual(await fs.readFile(file), Buffer.from([9, 9, 9]));
});

test('la copia rechaza un destino que no es un archivo normal', async () => {
  const workDir = workDirFor(await temp('jm-proj-'), await temp('jm-home-'));
  const folder = path.join('adjuntos', 'AQ-45');
  await fs.ensureDir(path.join(workDir, folder, '1-a.png'));
  assert.throws(() => writeReadOnlyCopy(workDir, folder, '1-a.png', Buffer.from([1])), /no es un archivo normal/);
});

test('la carpeta de trabajo y su base se crean solo para el usuario y las copias quedan en 0400', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows no usa modos POSIX');
    return;
  }
  const home = await temp('jm-home-');
  const workDir = workDirFor(await temp('jm-proj-'), home);
  const file = writeReadOnlyCopy(workDir, 'adjuntos', '1-a.png', Buffer.from([1]));
  assert.equal(fs.statSync(workBase(home)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(workDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o400);
});
