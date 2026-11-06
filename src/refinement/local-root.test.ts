import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { assertLocalRootAllowed, isHomeOrAbove } from './local-root';

const ROOT = path.parse(os.tmpdir()).root;
const HOME = path.join(ROOT, 'usuarios', 'yo');

test('rechaza la carpeta del usuario, un ancestro, la raíz del disco y la que contiene ~/.jira-tool', () => {
  for (const bad of [HOME, path.join(ROOT, 'usuarios'), ROOT]) {
    assert.throws(() => assertLocalRootAllowed(bad, HOME), /demasiado amplia/);
  }
});

test('acepta una carpeta específica, incluso dentro del usuario', () => {
  assertLocalRootAllowed(path.join(HOME, 'notas'), HOME);
  assertLocalRootAllowed(path.join(ROOT, 'bovedas', 'x'), HOME);
});

test('rechaza ~/.jira-tool y lo que cuelga de ella', () => {
  assert.throws(() => assertLocalRootAllowed(path.join(HOME, '.jira-tool'), HOME), /demasiado amplia/);
});

test('isHomeOrAbove ignora mayúsculas en Windows', (t) => {
  if (process.platform !== 'win32') {
    t.skip('solo aplica a Windows');
    return;
  }
  assert.ok(isHomeOrAbove(HOME.toUpperCase(), HOME.toLowerCase()));
});
