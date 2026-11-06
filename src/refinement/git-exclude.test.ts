import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { ensureGitExclude, excludeLineFor, findGitTop } from './git-exclude';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'jm-gitex-'));
async function makeGit(repo: string): Promise<string> {
  const gitDir = path.join(repo, '.git');
  await fs.ensureDir(path.join(gitDir, 'objects'));
  await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  return gitDir;
}
const excludeOf = (gitDir: string) => path.join(gitDir, 'info', 'exclude');

test('agrega /.jm/ una sola vez y es idempotente, sin tocar el .gitignore del equipo', async () => {
  const repo = await temp();
  await fs.ensureDir(path.join(await makeGit(repo), 'info'));
  await fs.writeFile(excludeOf(path.join(repo, '.git')), '# existente');
  await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules\n');
  ensureGitExclude(repo);
  ensureGitExclude(repo);
  assert.equal(await fs.readFile(excludeOf(path.join(repo, '.git')), 'utf8'), '# existente\n/.jm/\n');
  assert.equal(await fs.readFile(path.join(repo, '.gitignore'), 'utf8'), 'node_modules\n');
});

test('crea info/exclude si no existía', async () => {
  const repo = await temp();
  await makeGit(repo);
  ensureGitExclude(repo);
  assert.equal(await fs.readFile(excludeOf(path.join(repo, '.git')), 'utf8'), '/.jm/\n');
});

test('desde una subcarpeta del repositorio la línea lleva la ruta relativa', async () => {
  const repo = await temp();
  await makeGit(repo);
  const sub = path.join(repo, 'servicios', 'api');
  await fs.ensureDir(sub);
  ensureGitExclude(sub);
  assert.equal(await fs.readFile(excludeOf(path.join(repo, '.git')), 'utf8'), '/servicios/api/.jm/\n');
  assert.equal(excludeLineFor(repo, sub), '/servicios/api/.jm/');
});

test('worktree: .git es un archivo con gitdir y el exclude vive en la carpeta común', async () => {
  const main = await temp();
  const common = await makeGit(main);
  const worktreeGit = path.join(common, 'worktrees', 'rama');
  await fs.ensureDir(worktreeGit);
  await fs.writeFile(path.join(worktreeGit, 'HEAD'), 'ref: refs/heads/rama\n');
  await fs.writeFile(path.join(worktreeGit, 'commondir'), '../..');
  const worktree = await temp();
  await fs.writeFile(path.join(worktree, '.git'), `gitdir: ${worktreeGit}\n`);
  ensureGitExclude(worktree);
  assert.equal(await fs.readFile(excludeOf(common), 'utf8'), '/.jm/\n');
  assert.ok(!(await fs.pathExists(excludeOf(worktreeGit))));
});

test('sin repositorio no hace nada', async () => {
  const dir = await temp();
  const before = await fs.readdir(dir);
  ensureGitExclude(dir);
  assert.deepEqual(await fs.readdir(dir), before);
});

test('no escribe a través de un enlace en info/exclude', async (t) => {
  const repo = await temp();
  await fs.ensureDir(path.join(await makeGit(repo), 'info'));
  const outside = path.join(await temp(), 'ajeno');
  await fs.writeFile(outside, 'original');
  try {
    fs.symlinkSync(outside, excludeOf(path.join(repo, '.git')), 'file');
  } catch {
    t.skip('no se pueden crear enlaces');
    return;
  }
  assert.throws(() => ensureGitExclude(repo), /seguridad/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'original');
});

test('un .git de juguete (sin HEAD ni objects) se ignora en silencio', async () => {
  const repo = await temp();
  await fs.ensureDir(path.join(repo, '.git'));
  ensureGitExclude(repo);
  assert.ok(!(await fs.pathExists(excludeOf(path.join(repo, '.git')))));
});

test('un gitdir que apunta fuera de un repositorio real se ignora y no escribe allí', async () => {
  const victim = await temp();
  await makeGit(victim);
  const fakeGitDir = await temp();
  await fs.writeFile(path.join(fakeGitDir, 'HEAD'), 'x');
  await fs.writeFile(path.join(fakeGitDir, 'commondir'), path.join(victim, '.git'));
  const project = await temp();
  await fs.writeFile(path.join(project, '.git'), `gitdir: ${fakeGitDir}\n`);
  ensureGitExclude(project);
  assert.ok(!(await fs.pathExists(excludeOf(path.join(victim, '.git')))));
});

test('no sube hasta la carpeta del usuario: un repositorio ahí no recibe la línea', async () => {
  const home = await temp();
  await makeGit(home);
  const project = path.join(home, 'proyecto');
  await fs.ensureDir(project);
  ensureGitExclude(project, home);
  assert.ok(!(await fs.pathExists(excludeOf(path.join(home, '.git')))));
});

test('no sube por encima de un ancestro de la carpeta del usuario', async () => {
  const base = await temp();
  await makeGit(base);
  const home = path.join(base, 'usuarios', 'yo');
  const project = path.join(base, 'proyecto');
  await fs.ensureDir(home);
  await fs.ensureDir(project);
  ensureGitExclude(project, home);
  assert.ok(!(await fs.pathExists(excludeOf(path.join(base, '.git')))));
});

test('un proyecto fuera de la carpeta del usuario no recibe el .git de un ancestro lejano', async () => {
  const base = await temp();
  await makeGit(base);
  const home = await temp();
  const project = path.join(base, 'a', 'b');
  await fs.ensureDir(project);
  ensureGitExclude(project, home);
  assert.equal(await fs.readFile(excludeOf(path.join(base, '.git')), 'utf8'), '/a/b/.jm/\n');
});

test('nunca acepta un .git en la raíz del disco', async () => {
  const root = path.parse(os.tmpdir()).root;
  const project = path.join(os.tmpdir(), 'jm-gitex-noroot');
  assert.equal(findGitTop(root, path.join(root, 'otro', 'usuario')), null);
  assert.notEqual(findGitTop(project, path.join(root, 'otro', 'usuario')), root);
});

test('compara sin distinguir mayúsculas de la unidad en Windows', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('solo aplica a Windows');
    return;
  }
  const home = await temp();
  await makeGit(home);
  const project = path.join(home, 'proyecto');
  await fs.ensureDir(project);
  const swapped = home.charAt(0).toLowerCase() === home.charAt(0) ? home.toUpperCase() : home.toLowerCase();
  ensureGitExclude(project, swapped);
  assert.ok(!(await fs.pathExists(excludeOf(path.join(home, '.git')))));
});
