import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'stream';
import { reclaimStdin, releaseStdin } from './terminal';

test('reclaimStdin reanuda un stdin pausado por releaseStdin para que el proceso siga vivo', () => {
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  releaseStdin(stdin);
  assert.equal(stdin.isPaused(), true);
  reclaimStdin(stdin);
  assert.equal(stdin.isPaused(), false);
});
