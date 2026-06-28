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
