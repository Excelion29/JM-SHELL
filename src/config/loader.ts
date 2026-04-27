import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { GlobalConfig, ProjectConfig, JiraContext } from './types';
import { encrypt, decrypt } from '../utils/crypto';

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.jira-tool');
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'config.json');
const PROJECT_CONFIG_NAME = '.jira.json';
const CONTEXT_FILE_NAME = '.jira-context.json';

interface StoredConfig {
  encrypted: string;
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_FILE;
}

export async function globalConfigExists(): Promise<boolean> {
  return fs.pathExists(GLOBAL_CONFIG_FILE);
}

export async function saveGlobalConfig(config: GlobalConfig, pin: string): Promise<void> {
  await fs.ensureDir(GLOBAL_CONFIG_DIR);
  const plaintext = JSON.stringify(config);
  const stored: StoredConfig = { encrypted: encrypt(plaintext, pin) };
  await fs.writeJson(GLOBAL_CONFIG_FILE, stored, { spaces: 2 });
}

export async function loadGlobalConfig(pin: string): Promise<GlobalConfig> {
  if (!await fs.pathExists(GLOBAL_CONFIG_FILE)) {
    throw new Error('No inicializado. Ejecuta `jdf init` primero.');
  }
  const stored = await fs.readJson(GLOBAL_CONFIG_FILE) as StoredConfig;
  const plaintext = decrypt(stored.encrypted, pin);
  return JSON.parse(plaintext) as GlobalConfig;
}

export async function loadProjectConfig(): Promise<ProjectConfig> {
  const configPath = findFileUpward(PROJECT_CONFIG_NAME);
  if (!configPath) {
    throw new Error('No se encontró .jira.json. Ejecuta `jdf init` en el directorio del proyecto.');
  }
  return fs.readJson(configPath) as Promise<ProjectConfig>;
}

export async function saveProjectConfig(config: ProjectConfig, dir?: string): Promise<void> {
  const target = path.join(dir ?? process.cwd(), PROJECT_CONFIG_NAME);
  await fs.writeJson(target, config, { spaces: 2 });
}

export async function loadContext(): Promise<JiraContext | null> {
  const contextPath = findFileUpward(CONTEXT_FILE_NAME);
  if (!contextPath) return null;
  try {
    return await fs.readJson(contextPath) as JiraContext;
  } catch {
    return null;
  }
}

export async function saveContext(ctx: JiraContext): Promise<void> {
  const base = findFileUpward(PROJECT_CONFIG_NAME);
  const dir = base ? path.dirname(base) : process.cwd();
  await fs.writeJson(path.join(dir, CONTEXT_FILE_NAME), ctx, { spaces: 2 });
}

export function findFileUpward(filename: string): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
