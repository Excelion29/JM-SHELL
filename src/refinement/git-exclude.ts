import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isHomeOrAbove } from './local-root';
import { assertNoLinksIn, JM_DIR, lexists, safeEnsureDirIn, safeWriteFileIn } from './safe-fs';

const GIT_ENTRY = '.git';
const GITDIR_PREFIX = /^gitdir:\s*(.+)$/m;
const COMMON_DIR_FILE = 'commondir';
const INFO_DIR = 'info';
const EXCLUDE_FILE = 'exclude';
const HEAD_FILE = 'HEAD';
const OBJECTS_DIR = 'objects';
const WORKTREES_DIR = 'worktrees';
const MODULES_DIR = 'modules';

interface GitLocation {
  // Carpeta que contiene .git (la raíz del repositorio)
  top: string;
  // Carpeta donde viven info/exclude (la común si es un worktree)
  commonDir: string;
}

// No sube hasta la carpeta del usuario, sus ancestros ni la raíz del disco: un repositorio ahí no es el del proyecto
export function findGitTop(start: string, home: string): string | null {
  let current = path.resolve(start);
  while (!isHomeOrAbove(current, home)) {
    if (lexists(path.join(current, GIT_ENTRY))) return current;
    current = path.dirname(current);
  }
  return null;
}

const isRealGitDir = (dir: string): boolean =>
  lexists(path.join(dir, HEAD_FILE)) && lexists(path.join(dir, OBJECTS_DIR));

// Un gitdir ajeno (archivo .git manipulado) no debe llevarnos a escribir fuera del repositorio
function isOwnGitDir(gitDir: string, commonDir: string): boolean {
  if (gitDir === commonDir) return true;
  const parent = path.dirname(gitDir);
  return (
    path.dirname(parent) === commonDir &&
    (path.basename(parent) === WORKTREES_DIR || path.basename(parent) === MODULES_DIR)
  );
}

// En un worktree .git es un archivo "gitdir: <ruta>" y info/exclude vive en la carpeta común
function resolveCommonDir(top: string): string | null {
  const entry = path.join(top, GIT_ENTRY);
  if (fs.lstatSync(entry).isDirectory()) return isRealGitDir(entry) ? entry : null;
  const match = GITDIR_PREFIX.exec(fs.readFileSync(entry, 'utf8'));
  if (!match) return null;
  const gitDir = path.resolve(top, match[1].trim());
  const commonFile = path.join(gitDir, COMMON_DIR_FILE);
  const commonDir = lexists(commonFile) ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim()) : gitDir;
  return lexists(path.join(gitDir, HEAD_FILE)) && isRealGitDir(commonDir) && isOwnGitDir(gitDir, commonDir)
    ? commonDir
    : null;
}

function locateGit(root: string, home: string): GitLocation | null {
  const top = findGitTop(root, home);
  const commonDir = top ? resolveCommonDir(top) : null;
  return top && commonDir ? { top, commonDir } : null;
}

export const excludeLineFor = (top: string, root: string): string => {
  const relative = path.relative(top, root).split(path.sep).filter(Boolean);
  return `/${[...relative, JM_DIR].join('/')}/`;
};

// Agrega .jm a .git/info/exclude (sin tocar el .gitignore del equipo); sin repositorio no hace nada
export function ensureGitExclude(root: string, home: string = os.homedir()): void {
  const git = locateGit(root, home);
  if (!git) return;
  const infoDir = path.join(git.commonDir, INFO_DIR);
  const file = path.join(infoDir, EXCLUDE_FILE);
  const line = excludeLineFor(git.top, root);
  assertNoLinksIn(git.commonDir, file);
  if (lexists(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current.split(/\r?\n/).some((existing) => existing.trim() === line)) return;
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    safeWriteFileIn(git.commonDir, file, `${current}${separator}${line}\n`);
    return;
  }
  safeEnsureDirIn(git.commonDir, infoDir);
  safeWriteFileIn(git.commonDir, file, `${line}\n`);
}
