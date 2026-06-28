import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './_setup.js';
import { TurnObligationTracker } from '../src/turn-obligation.js';

test('open creates obligation with closed=false', () => {
  const t = new TurnObligationTracker();
  const o = t.open({
    turnId: 'T1', chatId: 'C1', threadId: null, openId: 'U1',
    startedAt: 1000, absoluteDeadline: 1000 + 600_000,
    idleTimeoutMs: 60_000, requireReply: true,
  });
  assert.equal(o.closed, false);
  assert.equal(o.hasReply, false);
  assert.equal(t.get('T1')?.chatId, 'C1');
});

test('tryCloseSuccess and tryCloseFailed are idempotent', () => {
  const t = new TurnObligationTracker();
  t.open({ turnId: 'T2', chatId: 'C', threadId: null, openId: 'U',
    startedAt: 0, absoluteDeadline: 100, idleTimeoutMs: 60, requireReply: true });
  assert.equal(t.tryCloseSuccess('T2', 'sid-x'), true);
  assert.equal(t.tryCloseSuccess('T2', 'sid-y'), false); // 2nd attempt ignored
  assert.equal(t.tryCloseFailed('T2', 'crash'), false);  // already closed
  const o = t.get('T2')!;
  assert.equal(o.success, true);
  assert.equal(o.sid, 'sid-x');
});

test('recordReply sets hasReply and lastMessageId; touchStreamEvent refreshes idle', () => {
  const t = new TurnObligationTracker();
  t.open({ turnId: 'T3', chatId: 'C', threadId: null, openId: 'U',
    startedAt: 0, absoluteDeadline: 100, idleTimeoutMs: 60, requireReply: true });
  t.recordReply('T3', 'om_abc');
  t.touchStreamEvent('T3', 50);
  const o = t.get('T3')!;
  assert.equal(o.hasReply, true);
  assert.equal(o.lastMessageId, 'om_abc');
  assert.equal(o.lastStreamEventAt, 50);
});

test('scanInflightDir parses orphan files', async () => {
  const tmp = makeTmpDir('inflight');
  try {
    const obligation = {
      turnId: 'T-orphan', chatId: 'C', threadId: null, openId: 'U',
      startedAt: 0, absoluteDeadline: 100, idleTimeoutMs: 60,
      lastStreamEventAt: 0, requireReply: true, hasReply: false,
      lastMessageId: null, sid: null, closed: false, success: false, reason: null,
    };
    writeFileSync(join(tmp.path, 'T-orphan.json'), JSON.stringify(obligation));
    writeFileSync(join(tmp.path, 'not-json.txt'), 'garbage');
    const t = new TurnObligationTracker();
    const found = await t.scanInflightDir(tmp.path);
    assert.equal(found.length, 1);
    assert.equal(found[0].turnId, 'T-orphan');
  } finally {
    tmp.cleanup();
  }
});
