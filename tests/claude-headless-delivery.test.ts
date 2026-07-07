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

test('unexpected runner throw closes obligation as failed (no watchdog zombie)', async () => {
  const tmp = makeTmpDir('deliv-throw');
  try {
    const { store, config } = makeSetup(tmp.path);
    await store.load();
    const tracker = new TurnObligationTracker();
    const handler: FallbackHandler = {
      onAbsoluteTimeout: async () => {},
      onIdleTimeout: async () => {},
      onCrash: async () => {},
      onSuccess: async () => {},
    };
    const fakeRunner = async (): Promise<RunResult> => {
      throw new Error('runner exploded');
    };
    const delivery = new HeadlessDelivery({
      tracker, sessionStore: store, config,
      runner: fakeRunner as any,
      semaphore: { acquire: async () => () => {} },
      envelope: () => 'envelope',
      handler,
      turnIdFactory: () => 'T-EX',
    });
    await assert.rejects(() => delivery.deliver(turn), /runner exploded/);
    const o = tracker.get('T-EX');
    assert.equal(o?.closed, true, 'obligation must be closed after unexpected throw');
    assert.equal(o?.success, false);
    assert.ok(o?.reason?.includes('unexpected'), `reason should mark unexpected error, got: ${o?.reason}`);
  } finally {
    tmp.cleanup();
  }
});

test('handleFallback with missing turn still closes an open obligation', async () => {
  const tmp = makeTmpDir('deliv-orphan');
  try {
    const { store, config } = makeSetup(tmp.path);
    await store.load();
    const tracker = new TurnObligationTracker();
    tracker.open({
      turnId: 'T-ORPHAN', chatId: 'C', threadId: null, openId: 'U',
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
    });
    // turnMap deliberately does NOT contain T-ORPHAN.
    await delivery.handleFallback('T-ORPHAN', 'timeout_absolute');
    assert.equal(tracker.get('T-ORPHAN')?.closed, true, 'orphan obligation must be closed');
    assert.deepEqual(calls, [], 'no handler fires without a turn to act on');
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

test('handleFallback aborts in-flight runner and deliver() resolves (I-NEW-1)', async () => {
  const tmp = makeTmpDir('deliv-4');
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

    // Latch: resolves once fakeRunner is entered so the test knows the
    // AbortController has been registered in deliver().
    let signalRunnerStarted!: () => void;
    const runnerStarted = new Promise<void>((r) => { signalRunnerStarted = r; });

    // Runner that stays pending until abortSignal fires.
    const fakeRunner = async (opts: { abortSignal?: AbortSignal }): Promise<RunResult> => {
      signalRunnerStarted();
      return new Promise((resolve) => {
        const onAbort = () => {
          resolve({
            sessionId: null, usage: null, finalText: null,
            exitCode: null, signal: 'SIGTERM', stderr: 'aborted', errorClass: 'crash',
          });
        };
        if (opts.abortSignal?.aborted) {
          onAbort();
        } else {
          opts.abortSignal?.addEventListener('abort', onAbort, { once: true });
        }
      });
    };

    const delivery = new HeadlessDelivery({
      tracker, sessionStore: store, config,
      runner: fakeRunner as any,
      semaphore: { acquire: async () => () => {} },
      envelope: () => 'envelope',
      handler,
      turnIdFactory: () => 'T-AB',
    });

    // Start deliver() — it will block inside fakeRunner until abort.
    const deliverPromise = delivery.deliver(turn);

    // Wait until the runner is actually executing (AbortController is now registered).
    await runnerStarted;

    const ac = (delivery as any).abortControllers.get('T-AB') as AbortController | undefined;
    assert.ok(ac, 'AbortController must be registered while runner is in-flight');
    assert.equal(ac.signal.aborted, false);

    // Trigger watchdog timeout — this should abort the runner.
    await delivery.handleFallback('T-AB', 'timeout_absolute');

    // deliver() must resolve (not hang) once abort fires.
    await deliverPromise;

    assert.ok(ac.signal.aborted, 'abort signal must have been triggered');
    assert.deepEqual(calls, ['abs']);

    // abortControllers map must be cleaned up by the finally block in deliver().
    assert.equal((delivery as any).abortControllers.has('T-AB'), false);
  } finally {
    tmp.cleanup();
  }
});
