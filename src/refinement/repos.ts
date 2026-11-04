import * as fs from 'fs';
import * as path from 'path';
import { findFileUpward, getGlobalConfigDir, PROJECT_CONFIG_NAME } from '../config/loader';
import { writeFileAtomicNoLinks } from '../utils/safe-write';
import { isValidProjectKey } from './browse';

const REPOS_FILE_NAME = 'repos.json';
const NO_CODE_DIR_NAME = 'sin-codigo';
const STORY_PROJECT_PATTERN = /^(.+)-\d+$/;
const WRAPPING_QUOTES = /^["']|["']$/g;

export type RepoMap = Record<string, string>;

export const reposPath = (): string => path.join(getGlobalConfigDir(), REPOS_FILE_NAME);
export const noCodeBase = (): string => path.join(getGlobalConfigDir(), NO_CODE_DIR_NAME);

export const projectKeyOfStory = (storyKey: string): string => STORY_PROJECT_PATTERN.exec(storyKey)?.[1] ?? storyKey;

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function readRepos(file = reposPath()): RepoMap {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`No pude leer ${file}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new Error(`El archivo ${file} no es un JSON válido: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const repos: RepoMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isValidProjectKey(key) && typeof value === 'string') repos[key] = value;
  }
  return repos;
}

export function normalizeFolderInput(input: string): string {
  return input.trim().replace(WRAPPING_QUOTES, '').trim();
}

export function validateRepoFolder(projectKey: string, input: string): string {
  if (!isValidProjectKey(projectKey)) throw new Error(`La clave de proyecto "${projectKey}" no es válida.`);
  const dir = normalizeFolderInput(input);
  if (!path.isAbsolute(dir)) throw new Error('Escribe una ruta absoluta, por ejemplo C:\\codigo\\mi-proyecto.');
  if (!isDirectory(dir)) throw new Error(`No encontré la carpeta ${dir}. Revisa la ruta.`);
  return dir;
}

export function saveRepo(projectKey: string, input: string, file = reposPath()): string {
  const dir = validateRepoFolder(projectKey, input);
  const repos = { ...readRepos(file), [projectKey]: dir };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomicNoLinks(file, `${JSON.stringify(repos, null, 2)}\n`);
  return dir;
}

// Un mapeo cuya carpeta ya no existe cuenta como sin mapeo
export function mappedRoot(projectKey: string, file = reposPath()): string | null {
  const dir = readRepos(file)[projectKey];
  return dir && isDirectory(dir) ? dir : null;
}

export interface CwdProject {
  projectKey: string;
  root: string;
}

export function readCwdProject(): CwdProject | null {
  const config = findFileUpward(PROJECT_CONFIG_NAME);
  if (!config) return null;
  try {
    const { projectKey } = JSON.parse(fs.readFileSync(config, 'utf8')) as { projectKey?: unknown };
    return typeof projectKey === 'string' && isValidProjectKey(projectKey)
      ? { projectKey, root: path.dirname(config) }
      : null;
  } catch {
    return null;
  }
}

export function noCodeRootPath(projectKey: string, base = noCodeBase()): string {
  if (!isValidProjectKey(projectKey)) throw new Error(`La clave de proyecto "${projectKey}" no es válida.`);
  return path.join(base, projectKey);
}

export function ensureNoCodeRoot(projectKey: string, base = noCodeBase()): string {
  const dir = noCodeRootPath(projectKey, base);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Solo el mapeo que el dev confirmó: el directorio actual nunca se asume como carpeta de código
export const resolveCodeRoot = (projectKey: string, file = reposPath()): string | null => mappedRoot(projectKey, file);

// Sugerencia para confirmar: el directorio actual, si su .jira.json es del mismo proyecto
export const suggestCodeRoot = (projectKey: string, cwdProject: CwdProject | null): string | null =>
  cwdProject?.projectKey === projectKey ? cwdProject.root : null;
