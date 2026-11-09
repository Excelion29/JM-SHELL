import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import type { JiraService } from '../services/jira';
import { PROJECT_CONFIG_NAME } from '../config/loader';
import { createFakeJira, tempRoot } from '../refinement/test-support';
import { createManagementBridge } from './management-bridge';

const PROJECT_FILE = { projectKey: 'AQ', defaultAssignee: 'acc-1' };

// El puente resuelve la carpeta desde el directorio actual: se trabaja en una temporal
async function withBridge(
  issues: Parameters<typeof createFakeJira>[0],
  run: (
    bridge: ReturnType<typeof createManagementBridge>,
    readFile: () => Promise<Record<string, unknown>>,
  ) => Promise<void>,
): Promise<void> {
  const root = await tempRoot();
  const file = path.join(root, PROJECT_CONFIG_NAME);
  await fs.writeJson(file, PROJECT_FILE);
  const previous = process.cwd();
  process.chdir(root);
  try {
    const bridge = createManagementBridge(() => createFakeJira(issues).jira as unknown as JiraService);
    await run(bridge, () => fs.readJson(file));
  } finally {
    process.chdir(previous);
  }
}

test('rechaza la clave de otro proyecto y la inválida sin tocar el archivo', async () => {
  await withBridge({ issues: { 'XY-1': {} } }, async (bridge, readFile) => {
    const other = await bridge.save('AQ', 'XY-1');
    assert.ok(!other.ok && /no es del proyecto AQ/.test(other.message));
    const invalid = await bridge.save('AQ', 'mala');
    assert.ok(!invalid.ok && /no es válida/.test(invalid.message));
    assert.deepEqual(await readFile(), PROJECT_FILE);
  });
});

test('save(null) guarda null y save con clave válida guarda la clave y el resumen', async () => {
  await withBridge({ issues: { 'AQ-7': {} } }, async (bridge, readFile) => {
    assert.deepEqual(await bridge.save('AQ', null), { ok: true });
    assert.deepEqual((await readFile()).management, { AQ: null });
    assert.equal(await bridge.status('AQ'), 'none');
    assert.deepEqual(await bridge.save('AQ', 'AQ-7'), { ok: true });
    assert.deepEqual(await bridge.status('AQ'), { key: 'AQ-7', summary: 'Resumen de AQ-7' });
  });
});

test('una clave que Jira no acepta (inexistente) se rechaza y no se guarda', async () => {
  await withBridge({ issues: {} }, async (bridge, readFile) => {
    const result = await bridge.save('AQ', 'AQ-9');
    assert.ok(!result.ok && /No encontré AQ-9/.test(result.message));
    assert.deepEqual(await readFile(), PROJECT_FILE);
  });
});

test('el resumen con caracteres de control se limpia al guardar', async () => {
  await withBridge({ issues: { 'AQ-7': {} } }, async (bridge, readFile) => {
    const { jira } = createFakeJira({ issues: { 'AQ-7': {} } });
    const dirty = {
      ...jira,
      getIssue: async (key: string) => {
        const issue = await jira.getIssue(key);
        return { ...issue, fields: { ...issue.fields, summary: '\u001b[31mGestión\u0007' } };
      },
    };
    const custom = createManagementBridge(() => dirty as unknown as JiraService);
    assert.deepEqual(await custom.save('AQ', 'AQ-7'), { ok: true });
    const saved = (await readFile()).management as Record<string, { summary: string }>;
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(saved.AQ.summary));
    assert.ok(saved.AQ.summary.includes('Gestión'));
    void bridge;
  });
});
