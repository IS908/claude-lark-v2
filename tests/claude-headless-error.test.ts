import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyExit, classifyTimeout } from '../src/claude-headless-error.js';

test('exit 0 with empty stderr is unknown (no signal, success path handled elsewhere)', () => {
  assert.equal(classifyExit(0, null, ''), 'unknown');
});

test('SIGKILL signal is crash', () => {
  assert.equal(classifyExit(null, 'SIGKILL', ''), 'crash');
});

test('SIGTERM signal is crash', () => {
  assert.equal(classifyExit(null, 'SIGTERM', ''), 'crash');
});

test('non-zero exit is internal', () => {
  assert.equal(classifyExit(1, null, ''), 'internal');
});

test('OOM marker in stderr classifies as crash regardless of exit', () => {
  assert.equal(classifyExit(1, null, 'JavaScript heap out of memory'), 'crash');
});

test('clean exit 0 with benign "killed" noise in stderr is NOT a crash', () => {
  assert.equal(classifyExit(0, null, 'debug: watchdog killed stale cache entry'), 'unknown');
});

test('classifyTimeout maps cleanly', () => {
  assert.equal(classifyTimeout('absolute'), 'timeout_absolute');
  assert.equal(classifyTimeout('idle'), 'timeout_idle');
});
