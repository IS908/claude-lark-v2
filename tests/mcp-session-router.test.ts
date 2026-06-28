import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SessionTokenMap } from '../src/mcp-session-router.js';

test('register then resolve returns caller', () => {
  const m = new SessionTokenMap();
  m.register('tok-1', { chatId: 'C', threadId: 'T', openId: 'U' }, 600_000, 1000);
  assert.deepEqual(m.resolve('tok-1', 1500), { chatId: 'C', threadId: 'T', openId: 'U' });
});

test('expired token resolves to null', () => {
  const m = new SessionTokenMap();
  m.register('tok-x', { chatId: 'C', threadId: null, openId: 'U' }, 100, 1000);
  assert.notEqual(m.resolve('tok-x', 1099), null);
  assert.equal(m.resolve('tok-x', 1101), null);
});

test('revoke removes token', () => {
  const m = new SessionTokenMap();
  m.register('t', { chatId: 'C', threadId: null, openId: 'U' }, 1000, 0);
  m.revoke('t');
  assert.equal(m.resolve('t', 100), null);
});

test('purgeExpired removes expired entries and returns count', () => {
  const m = new SessionTokenMap();
  m.register('a', { chatId: 'C', threadId: null, openId: 'U' }, 100, 0);
  m.register('b', { chatId: 'C', threadId: null, openId: 'U' }, 10_000, 0);
  const n = m.purgeExpired(200);
  assert.equal(n, 1);
  assert.equal(m.resolve('a', 200), null);
  assert.notEqual(m.resolve('b', 200), null);
});

test('unknown token resolves to null', () => {
  const m = new SessionTokenMap();
  assert.equal(m.resolve('nope', 0), null);
});
