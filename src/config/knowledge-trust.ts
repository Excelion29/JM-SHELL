import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import type { KnowledgeConfig } from '../refinement/knowledge';
import { getGlobalConfigDir } from './loader';

const TRUST_FILE = 'knowledge-trust.json';
const TRUST_FILE_MODE = 0o600;
const IS_WINDOWS = process.platform === 'win32';

type TrustStore = Record<string, string>;

// El .jira.json de un repo clonado puede apuntar a cualquier servidor: la base solo se usa tras confirmarla aquí
const folderKey = (root: string) => (IS_WINDOWS ? path.resolve(root).toLowerCase() : path.resolve(root));

export function knowledgeConfigHash(config: KnowledgeConfig): string {
  const identity =
    config.type === 'mcp'
      ? [config.type, config.url, config.baseFolder, config.tls]
      : config.type === 'local'
        ? [config.type, config.root, config.baseFolder]
        : [config.type];
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function readTrust(file: string): Promise<TrustStore> {
  return (await fs.pathExists(file)) ? ((await fs.readJson(file)) as TrustStore) : {};
}

export async function isKnowledgeTrusted(
  root: string,
  config: KnowledgeConfig,
  dir = getGlobalConfigDir(),
): Promise<boolean> {
  if (config.type === 'none') return true;
  return (await readTrust(path.join(dir, TRUST_FILE)))[folderKey(root)] === knowledgeConfigHash(config);
}

export async function trustKnowledge(root: string, config: KnowledgeConfig, dir = getGlobalConfigDir()): Promise<void> {
  const file = path.join(dir, TRUST_FILE);
  await fs.ensureDir(dir);
  const store = await readTrust(file);
  store[folderKey(root)] = knowledgeConfigHash(config);
  await fs.writeJson(file, store, { spaces: 2, mode: TRUST_FILE_MODE });
}
