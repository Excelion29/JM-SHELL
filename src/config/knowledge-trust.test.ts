import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import type { KnowledgeConfig } from '../refinement/knowledge';
import { isKnowledgeTrusted, knowledgeConfigHash, trustKnowledge } from './knowledge-trust';

const MCP: KnowledgeConfig = { type: 'mcp', url: 'https://127.0.0.1:27124/mcp', baseFolder: 'P/X', tls: 'system' };
const FOLDER_A = path.join(os.tmpdir(), 'proyecto-a');
const FOLDER_B = path.join(os.tmpdir(), 'proyecto-b');

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'jm-trust-'));

test('la confianza es por carpeta y por configuración: cualquier cambio la invalida', async () => {
  const dir = await tempDir();
  assert.ok(!(await isKnowledgeTrusted(FOLDER_A, MCP, dir)));
  await trustKnowledge(FOLDER_A, MCP, dir);
  assert.ok(await isKnowledgeTrusted(FOLDER_A, MCP, dir));
  assert.ok(!(await isKnowledgeTrusted(FOLDER_B, MCP, dir)));
  for (const changed of [
    { ...MCP, url: 'https://evil.example/mcp' },
    { ...MCP, baseFolder: 'P' },
    { ...MCP, tls: 'pinned' as const },
  ]) {
    assert.ok(!(await isKnowledgeTrusted(FOLDER_A, changed, dir)));
  }
  assert.ok(await isKnowledgeTrusted(FOLDER_B, { type: 'none' }, dir));
});

test('el hash distingue tipo, destino y carpeta base de una base local', () => {
  const local: KnowledgeConfig = { type: 'local', root: 'C:\\notas', baseFolder: 'P' };
  assert.notEqual(knowledgeConfigHash(local), knowledgeConfigHash({ ...local, root: 'C:\\otras' }));
  assert.notEqual(knowledgeConfigHash(local), knowledgeConfigHash({ ...local, baseFolder: '' }));
  assert.equal(knowledgeConfigHash(local), knowledgeConfigHash({ ...local }));
});
