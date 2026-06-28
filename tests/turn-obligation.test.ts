import { test } from 'node:test';
import { strict as assert } from 'node:assert';

test('smoke: node:test runner works on tsx-loaded ESM', () => {
  assert.equal(1 + 1, 2);
});
