import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  ensureNoCodeRoot,
  mappedRoot,
  noCodeRootPath,
  projectKeyOfStory,
  readRepos,
  resolveCodeRoot,
  saveRepo,
  suggestCodeRoot,
} from './repos';

async function sandbox() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'jm-repos-'));
  const code = path.join(base, 'codigo');
  await fs.ensureDir(code);
  return { base, code, file: path.join(base, 'cfg', 'repos.json') };
}

test('sin archivo no hay mapeos', async () => {
  const { file } = await sandbox();
  assert.deepEqual(readRepos(file), {});
});

test('guarda y lee un mapeo, creando la carpeta de configuración', async () => {
  const { code, file } = await sandbox();
  assert.equal(saveRepo('AQ', code, file), code);
  assert.deepEqual(readRepos(file), { AQ: code });
  assert.equal(mappedRoot('AQ', file), code);
});

test('acepta la ruta pegada entre comillas', async () => {
  const { code, file } = await sandbox();
  saveRepo('AQ', `"${code}"`, file);
  assert.equal(readRepos(file).AQ, code);
});

test('valida clave de proyecto, ruta absoluta y carpeta existente', async () => {
  const { base, code, file } = await sandbox();
  assert.throws(() => saveRepo('aq', code, file), /no es válida/);
  assert.throws(() => saveRepo('AQ', 'relativa/ruta', file), /ruta absoluta/);
  assert.throws(() => saveRepo('AQ', path.join(base, 'no-existe'), file), /No encontré la carpeta/);
  const plainFile = path.join(base, 'archivo.txt');
  await fs.writeFile(plainFile, 'x');
  assert.throws(() => saveRepo('AQ', plainFile, file), /No encontré la carpeta/);
  assert.deepEqual(readRepos(file), {});
});

test('un JSON corrupto falla con contexto y no se pisa en silencio', async () => {
  const { file } = await sandbox();
  await fs.outputFile(file, '{no json');
  assert.throws(() => readRepos(file), /no es un JSON válido/);
});

test('ignora entradas con clave inválida o valor que no es texto', async () => {
  const { code, file } = await sandbox();
  await fs.outputJson(file, { AQ: code, bad: code, XY: 3 });
  assert.deepEqual(readRepos(file), { AQ: code });
});

test('rechaza escribir si repos.json es un enlace simbólico', async (t) => {
  const { base, code, file } = await sandbox();
  await fs.ensureDir(path.dirname(file));
  const target = path.join(base, 'real.json');
  await fs.writeFile(target, '{}');
  try {
    fs.symlinkSync(target, file, 'file');
  } catch (err: unknown) {
    t.skip(`no se pueden crear enlaces (${(err as NodeJS.ErrnoException).code})`);
    return;
  }
  assert.throws(() => saveRepo('AQ', code, file), /enlace simbólico/);
  assert.equal(await fs.readFile(target, 'utf8'), '{}');
});

test('un mapeo cuya carpeta ya no existe cuenta como sin mapeo', async () => {
  const { base, file } = await sandbox();
  const gone = path.join(base, 'borrada');
  await fs.ensureDir(gone);
  saveRepo('AQ', gone, file);
  await fs.remove(gone);
  assert.equal(mappedRoot('AQ', file), null);
});

test('resolveCodeRoot solo devuelve lo confirmado: nunca asume el directorio actual', async () => {
  const { base, code, file } = await sandbox();
  assert.equal(resolveCodeRoot('AQ', file), null);
  assert.deepEqual(readRepos(file), {});
  saveRepo('AQ', code, file);
  assert.equal(resolveCodeRoot('AQ', file), code);
  assert.equal(resolveCodeRoot('XY', file), null);
  assert.equal(await fs.pathExists(path.join(base, 'cfg', 'repos.json')), true);
});

test('suggestCodeRoot sugiere el directorio actual solo si su proyecto coincide', () => {
  const cwd = { projectKey: 'PM', root: 'C:\repo' };
  assert.equal(suggestCodeRoot('PM', cwd), 'C:\repo');
  assert.equal(suggestCodeRoot('AQ', cwd), null);
  assert.equal(suggestCodeRoot('AQ', null), null);
});

test('sin código: carpeta propia por proyecto, creada bajo demanda y con clave validada', async () => {
  const { base } = await sandbox();
  const noCodeBase = path.join(base, 'sin-codigo');
  const expected = path.join(noCodeBase, 'AQ');
  assert.equal(noCodeRootPath('AQ', noCodeBase), expected);
  assert.equal(await fs.pathExists(expected), false);
  assert.equal(ensureNoCodeRoot('AQ', noCodeBase), expected);
  assert.equal(await fs.pathExists(expected), true);
  assert.throws(() => noCodeRootPath('../x', base), /no es válida/);
});

test('la clave del proyecto sale de la clave de la historia', () => {
  assert.equal(projectKeyOfStory('AQ-45'), 'AQ');
  assert.equal(projectKeyOfStory('MY_PROJ-7'), 'MY_PROJ');
});
