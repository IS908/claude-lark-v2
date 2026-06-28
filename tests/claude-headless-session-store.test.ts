import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { makeTmpDir } from './_setup.js';
import { HeadlessSessionStore } from '../src/claude-headless-session-store.js';

test('get returns null when not set', async () => {
  const tmp = makeTmpDir('store-1');
  try {
    const store = new HeadlessSessionStore(join(tmp.path, 'sessions.json'));
    await store.load();
    assert.equal(store.get('C', 'T'), null);
  } finally {
    tmp.cleanup();
  }
});

test('set then get round-trips and persists across instances', async () => {
  const tmp = makeTmpDir('store-2');
  try {
    const path = join(tmp.path, 'sessions.json');
    const store = new HeadlessSessionStore(path);
    await store.load();
    await store.set('chat', 'thread', { sid: 'sid-1', lastSuccessAt: 100, lastBotMessageId: 'om_1' });
    const got = store.get('chat', 'thread');
    assert.deepEqual(got, { sid: 'sid-1', lastSuccessAt: 100, lastBotMessageId: 'om_1' });

    const store2 = new HeadlessSessionStore(path);
    await store2.load();
    assert.deepEqual(store2.get('chat', 'thread'), got);
  } finally {
    tmp.cleanup();
  }
});

test('null threadId is its own key, distinct from "null" string', async () => {
  const tmp = makeTmpDir('store-3');
  try {
    const store = new HeadlessSessionStore(join(tmp.path, 'sessions.json'));
    await store.load();
    await store.set('c', null, { sid: 'sN', lastSuccessAt: 1, lastBotMessageId: null });
    await store.set('c', 'null', { sid: 'sS', lastSuccessAt: 2, lastBotMessageId: null });
    assert.equal(store.get('c', null)?.sid, 'sN');
    assert.equal(store.get('c', 'null')?.sid, 'sS');
  } finally {
    tmp.cleanup();
  }
});

test('concurrent set on same key serializes', async () => {
  const tmp = makeTmpDir('store-4');
  try {
    const store = new HeadlessSessionStore(join(tmp.path, 'sessions.json'));
    await store.load();
    await Promise.all([
      store.set('c', 't', { sid: 's-a', lastSuccessAt: 1, lastBotMessageId: null }),
      store.set('c', 't', { sid: 's-b', lastSuccessAt: 2, lastBotMessageId: null }),
    ]);
    const got = store.get('c', 't');
    assert.ok(got?.sid === 's-a' || got?.sid === 's-b'); // either last-write wins
    assert.ok(typeof got?.lastSuccessAt === 'number');
  } finally {
    tmp.cleanup();
  }
});
