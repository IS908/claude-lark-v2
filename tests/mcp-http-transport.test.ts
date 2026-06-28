import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createHttpTransport } from '../src/mcp-http-transport.js';

test('createHttpTransport returns a transport object with required fields', () => {
  const t = createHttpTransport({ sessionIdGenerator: () => randomUUID() });
  assert.ok(t);
  assert.equal(typeof t.handleRequest, 'function');
});

test('onClose hook fires when transport closes', () => {
  let closed = false;
  const t = createHttpTransport({
    sessionIdGenerator: () => 'fixed',
    onClose: () => { closed = true; },
  });
  t.onclose?.();
  assert.equal(closed, true);
});
