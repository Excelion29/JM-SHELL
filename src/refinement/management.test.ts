import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANAGEMENT_SUMMARY_MAX_LENGTH, managementStatusOf } from './management';

test('al leer, el resumen pierde las secuencias de escape y se recorta', () => {
  const project = {
    management: {
      AQ: {
        key: 'AQ-7',
        summary: `\u001b[31mGestión\u001b]0;título\u0007${'x'.repeat(MANAGEMENT_SUMMARY_MAX_LENGTH * 2)}`,
      },
    },
  };
  const status = managementStatusOf(project, 'AQ');
  assert.ok(typeof status === 'object');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(status.summary));
  assert.ok(status.summary.length <= MANAGEMENT_SUMMARY_MAX_LENGTH);
  assert.ok(status.summary.includes('Gestión'));
});
