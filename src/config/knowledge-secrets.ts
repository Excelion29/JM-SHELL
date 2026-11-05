import * as fs from 'fs-extra';
import * as path from 'path';
import { getGlobalConfigDir } from './loader';
import { assertSingleCertificate } from '../refinement/knowledge-tls';
import { decrypt, encrypt } from '../utils/crypto';

const KEYS_FILE = 'knowledge-keys.json';
const CERTS_DIR = 'kb-certs';
const SECRET_FILE_MODE = 0o600;
const UNSAFE_FILE_CHARS = /[^A-Za-z0-9._-]/g;

type KeyStore = Record<string, string>;

// Las llaves y los certificados viven aquí, nunca en el .jira.json de la carpeta
const hostOf = (url: string) => new URL(url).host;
const certFile = (dir: string, url: string) =>
  path.join(dir, CERTS_DIR, `${hostOf(url).replace(UNSAFE_FILE_CHARS, '_')}.crt`);

async function readKeys(file: string): Promise<KeyStore> {
  if (!(await fs.pathExists(file))) return {};
  return (await fs.readJson(file)) as KeyStore;
}

export async function saveKnowledgeKey(
  url: string,
  apiKey: string,
  pin: string,
  dir = getGlobalConfigDir(),
): Promise<void> {
  const file = path.join(dir, KEYS_FILE);
  await fs.ensureDir(dir);
  const keys = await readKeys(file);
  keys[hostOf(url)] = encrypt(apiKey, pin);
  await fs.writeJson(file, keys, { spaces: 2, mode: SECRET_FILE_MODE });
}

export async function loadKnowledgeKey(url: string, pin: string, dir = getGlobalConfigDir()): Promise<string | null> {
  const encrypted = (await readKeys(path.join(dir, KEYS_FILE)))[hostOf(url)];
  return encrypted ? decrypt(encrypted, pin) : null;
}

export async function saveKnowledgeCert(url: string, pem: string, dir = getGlobalConfigDir()): Promise<void> {
  assertSingleCertificate(pem);
  const file = certFile(dir, url);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, pem, { encoding: 'utf8', mode: SECRET_FILE_MODE });
}

export async function loadKnowledgeCert(url: string, dir = getGlobalConfigDir()): Promise<string | null> {
  const file = certFile(dir, url);
  if (!(await fs.pathExists(file))) return null;
  const pem = await fs.readFile(file, 'utf8');
  assertSingleCertificate(pem);
  return pem;
}
