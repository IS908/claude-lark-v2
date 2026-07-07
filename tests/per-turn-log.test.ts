import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { makeTmpDir } from './_setup.js';
import { PerTurnLogger } from '../src/per-turn-log.js';

test('writes append-only log under correct subdir', async () => {
  const tmp = makeTmpDir('per-turn-log');
  try {
    const logger = new PerTurnLogger(tmp.path);
    const w = logger.open('chat-A', 'thread-1', 1000);
    await w.append('first');
    await w.append('second');
    await w.close();
    assert.ok(existsSync(w.path));
    const content = readFileSync(w.path, 'utf8');
    assert.match(content, /first\nsecond\n/);
    assert.match(w.path, /chat-A\/thread-1\//);
  } finally {
    tmp.cleanup();
  }
});

test('null threadId falls back to `_root` segment', async () => {
  const tmp = makeTmpDir('per-turn-log');
  try {
    const logger = new PerTurnLogger(tmp.path);
    const w = logger.open('chat-B', null, 1500);
    await w.append('only');
    await w.close();
    assert.match(w.path, /chat-B\/_root\//);
  } finally {
    tmp.cleanup();
  }
});

test('multiple appends after close are no-op', async () => {
  const tmp = makeTmpDir('per-turn-log');
  try {
    const logger = new PerTurnLogger(tmp.path);
    const w = logger.open('c', null, 1);
    await w.append('a');
    await w.close();
    await w.append('after-close'); // silently ignored
    const content = readFileSync(w.path, 'utf8');
    assert.match(content, /^a\n$/);
  } finally {
    tmp.cleanup();
  }
});

test('sanitizeSegment rejects dot-only segments to prevent path traversal', async () => {
  const tmp = makeTmpDir('per-turn-log');
  try {
    const logger = new PerTurnLogger(tmp.path);

    // Test single dot
    const w1 = logger.open('.', null, 1);
    assert.ok(w1.path.includes('_'), 'single dot should be sanitized to underscore');
    assert.ok(!w1.path.includes('/./"'), 'path should not contain /./');
    await w1.close();

    // Test double dot (path traversal attempt)
    const w2 = logger.open('..', 'thread-x', 2);
    assert.ok(w2.path.includes('_'), 'double dot should be sanitized to underscore');
    assert.ok(!w2.path.includes('/../'), 'path should not contain /../');
    await w2.close();

    // Test triple dot
    const w3 = logger.open('chat', '...', 3);
    assert.ok(w3.path.includes('_'), 'triple dot should be sanitized to underscore');
    await w3.close();
  } finally {
    tmp.cleanup();
  }
});
