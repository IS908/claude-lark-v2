import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { TurnObligationTracker } from '../src/turn-obligation.js';
import { HeadlessWatchdog } from '../src/headless-watchdog.js';

test('absolute timeout triggers onFallback once', async () => {
  const tracker = new TurnObligationTracker();
  tracker.open({
    turnId: 'T-abs', chatId: 'C', threadId: null, openId: 'U',
    startedAt: 0, absoluteDeadline: 100, idleTimeoutMs: 1000, requireReply: true,
  });
  const triggered: Array<[string, string]> = [];
  const wd = new HeadlessWatchdog({
    tracker,
    intervalMs: 30_000,
    onFallback: async (id, reason) => { triggered.push([id, reason]); },
  });
  await wd.tickOnce(150);
  assert.deepEqual(triggered, [['T-abs', 'timeout_absolute']]);
});

test('idle timeout triggers onFallback', async () => {
  const tracker = new TurnObligationTracker();
  tracker.open({
    turnId: 'T-idle', chatId: 'C', threadId: null, openId: 'U',
    startedAt: 0, absoluteDeadline: 100_000, idleTimeoutMs: 50, requireReply: true,
  });
  // lastStreamEventAt set to startedAt (=0) by open()
  const triggered: Array<[string, string]> = [];
  const wd = new HeadlessWatchdog({
    tracker,
    intervalMs: 30_000,
    onFallback: async (id, reason) => { triggered.push([id, reason]); },
  });
  await wd.tickOnce(100);
  assert.deepEqual(triggered, [['T-idle', 'timeout_idle']]);
});

test('closed obligation is not triggered', async () => {
  const tracker = new TurnObligationTracker();
  tracker.open({
    turnId: 'T-c', chatId: 'C', threadId: null, openId: 'U',
    startedAt: 0, absoluteDeadline: 100, idleTimeoutMs: 50, requireReply: true,
  });
  tracker.tryCloseSuccess('T-c', 'sid');
  const triggered: string[] = [];
  const wd = new HeadlessWatchdog({
    tracker,
    intervalMs: 30_000,
    onFallback: async (id) => { triggered.push(id); },
  });
  await wd.tickOnce(200);
  assert.deepEqual(triggered, []);
});

test('start/stop manages interval and is idempotent', () => {
  const tracker = new TurnObligationTracker();
  const wd = new HeadlessWatchdog({
    tracker,
    intervalMs: 50,
    onFallback: async () => {},
  });
  wd.start();
  wd.start(); // idempotent
  wd.stop();
  wd.stop();  // idempotent
  assert.ok(true);
});
