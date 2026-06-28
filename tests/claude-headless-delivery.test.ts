import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { makeTmpDir } from './_setup.js';
import { TurnObligationTracker } from '../src/turn-obligation.js';
import { HeadlessSessionStore } from '../src/claude-headless-session-store.js';
import { HeadlessConfigManager } from '../src/claude-headless-config.js';
import { SessionTokenMap } from '../src/mcp-session-router.js';
import { HeadlessDelivery, type FallbackHandler } from '../src/claude-headless-delivery.js';
import type { InboundTurn } from '../src/inbound-turn-pipeline.js';
import type { RunResult } from '../src/claude-headless.js';

function makeSetup(tmpPath: string) {
  const cwd = join(tmpPath, 'headless-cwd');
  const store = new HeadlessSessionStore(join(tmpPath, 'sessions.json'));
  const tokenMap = new SessionTokenMap();
  const config = new HeadlessConfigManager({
    headlessCwd: cwd,
    httpUrl: 'http://127.0.0.1:1234/mcp',
    sessionStore: store,
    tokenMap,
    promptPath: '/nope.md',
    tokenTtlMs: 600_000,
    absoluteTimeoutMs: 1_800_000,
    idleTimeoutMs: 300_000,
    nonceFactory: () => 'tk',
  });
  return { store, tokenMap, config };
}

const turn: InboundTurn = {
  kind: 'im_p2p', chatId: 'C', threadId: null, openId: 'U',
  messageId: 'om_1', text: 'hi', imagePaths: [], requireReply: true, rawMeta: {},
};

test('successful run updates sessionStore and calls onSuccess', async () => {
  const tmp = makeTmpDir('deliv-1');
  try {
    const { store, config } = makeSetup(tmp.path);
    await store.load();
    const tracker = new TurnObligationTracker();
    const calls: string[] = [];
    const handler: FallbackHandler = {
      onAbsoluteTimeout: async () => { calls.push('abs'); },
      onIdleTimeout: async () => { calls.push('idle'); },
      onCrash: async () => { calls.push('crash'); },
      onSuccess: async () => { calls.push('success'); },
    };
    const fakeRunner = async (): Promise<RunResult> => ({
      sessionId: 'sid-OK', usage: null, finalText: 'reply text', exitCode: 0, signal: null, stderr: '', errorClass: 'unknown',
    });
    const sem = { acquire: async () => () => {} };
    const delivery = new HeadlessDelivery({
      tracker, sessionStore: store, config,
      runner: fakeRunner as any,
      semaphore: sem,
      envelope: () => 'envelope',
      handler,
      turnIdFactory: () => 'T-OK',
    });
    await delivery.deliver(turn);
    assert.deepEqual(calls, ['success']);
    assert.equal(store.get('C', null)?.sid, 'sid-OK');
    assert.equal(tracker.get('T-OK')?.closed, true);
    assert.equal(tracker.get('T-OK')?.success, true);
  } finally {
    tmp.cleanup();
  }
});

test('crash result fires onCrash and does NOT update sessionStore', async () => {
  const tmp = makeTmpDir('deliv-2');
  try {
    const { store, config } = makeSetup(tmp.path);
    await store.load();
    await store.set('C', null, { sid: 'sid-prior', lastSuccessAt: 1, lastBotMessageId: null });
    const tracker = new TurnObligationTracker();
    const calls: string[] = [];
    const handler: FallbackHandler = {
      onAbsoluteTimeout: async () => { calls.push('abs'); },
      onIdleTimeout: async () => { calls.push('idle'); },
      onCrash: async () => { calls.push('crash'); },
      onSuccess: async () => { calls.push('success'); },
    };
    const fakeRunner = async (): Promise<RunResult> => ({
      sessionId: null, usage: null, finalText: null, exitCode: null, signal: 'SIGKILL', stderr: 'oom', errorClass: 'crash',
    });
    const sem = { acquire: async () => () => {} };
    const delivery = new HeadlessDelivery({
      tracker, sessionStore: store, config,
      runner: fakeRunner as any,
      semaphore: sem,
      envelope: () => 'envelope',
      handler,
      turnIdFactory: () => 'T-CR',
    });
    await delivery.deliver(turn);
    assert.deepEqual(calls, ['crash']);
    assert.equal(store.get('C', null)?.sid, 'sid-prior'); // unchanged
  } finally {
    tmp.cleanup();
  }
});

test('handleFallback wires watchdog timeout to handler', async () => {
  const tmp = makeTmpDir('deliv-3');
  try {
    const { store, config } = makeSetup(tmp.path);
    await store.load();
    const tracker = new TurnObligationTracker();
    tracker.open({
      turnId: 'T-WD', chatId: 'C', threadId: null, openId: 'U',
      startedAt: 0, absoluteDeadline: 100, idleTimeoutMs: 50, requireReply: true,
    });
    const calls: string[] = [];
    const handler: FallbackHandler = {
      onAbsoluteTimeout: async () => { calls.push('abs'); },
      onIdleTimeout: async () => { calls.push('idle'); },
      onCrash: async () => { calls.push('crash'); },
      onSuccess: async () => { calls.push('success'); },
    };
    const delivery = new HeadlessDelivery({
      tracker, sessionStore: store, config,
      runner: (async () => ({} as RunResult)) as any,
      semaphore: { acquire: async () => () => {} },
      envelope: () => 'env',
      handler,
      turnIdFactory: () => 'T-WD',
    });
    // Pre-track the turn so handleFallback can look it up
    (delivery as any).turnMap.set('T-WD', turn);
    await delivery.handleFallback('T-WD', 'timeout_absolute');
    assert.deepEqual(calls, ['abs']);
    assert.equal(tracker.get('T-WD')?.closed, true);
  } finally {
    tmp.cleanup();
  }
});
