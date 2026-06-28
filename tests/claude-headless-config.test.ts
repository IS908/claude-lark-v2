import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './_setup.js';
import { HeadlessConfigManager } from '../src/claude-headless-config.js';
import { HeadlessSessionStore } from '../src/claude-headless-session-store.js';
import { SessionTokenMap } from '../src/mcp-session-router.js';

test('ensureCwd writes static .mcp.json with ${LARK_CHILD_TOKEN} placeholder', async () => {
  const tmp = makeTmpDir('hcfg-1');
  try {
    const cwd = join(tmp.path, 'headless-cwd');
    const store = new HeadlessSessionStore(join(tmp.path, 's.json'));
    await store.load();
    const mgr = new HeadlessConfigManager({
      headlessCwd: cwd,
      httpUrl: 'http://127.0.0.1:38291/mcp',
      sessionStore: store,
      tokenMap: new SessionTokenMap(),
      promptPath: '/nope/prompt.md',
      tokenTtlMs: 600_000,
      absoluteTimeoutMs: 1_800_000,
      idleTimeoutMs: 300_000,
    });
    await mgr.ensureCwd();
    const mcpPath = join(cwd, '.mcp.json');
    assert.ok(existsSync(mcpPath));
    const cfg = JSON.parse(readFileSync(mcpPath, 'utf8'));
    assert.equal(cfg.mcpServers.lark.url, 'http://127.0.0.1:38291/mcp');
    assert.equal(cfg.mcpServers.lark.headers['X-Lark-Session-Token'], '${LARK_CHILD_TOKEN}');
  } finally {
    tmp.cleanup();
  }
});

test('prepareSpawn registers token in tokenMap and returns env', async () => {
  const tmp = makeTmpDir('hcfg-2');
  try {
    const cwd = join(tmp.path, 'headless-cwd');
    const store = new HeadlessSessionStore(join(tmp.path, 's.json'));
    await store.load();
    const tokenMap = new SessionTokenMap();
    const mgr = new HeadlessConfigManager({
      headlessCwd: cwd,
      httpUrl: 'http://127.0.0.1:38291/mcp',
      sessionStore: store,
      tokenMap,
      promptPath: '/nope.md',
      tokenTtlMs: 600_000,
      absoluteTimeoutMs: 1_800_000,
      idleTimeoutMs: 300_000,
      nonceFactory: () => 'fixed-nonce',
    });
    await mgr.ensureCwd();
    const ctx = await mgr.prepareSpawn({ chatId: 'C', threadId: 'T', openId: 'U', now: 100 });
    assert.equal(ctx.token, 'fixed-nonce');
    assert.equal(ctx.env.LARK_CHILD_TOKEN, 'fixed-nonce');
    assert.equal(ctx.sid, null); // first spawn, no prior sid
    assert.equal(ctx.absoluteDeadline, 100 + 1_800_000);
    assert.deepEqual(tokenMap.resolve('fixed-nonce', 200), { chatId: 'C', threadId: 'T', openId: 'U' });
  } finally {
    tmp.cleanup();
  }
});

test('prepareSpawn returns existing sid from sessionStore', async () => {
  const tmp = makeTmpDir('hcfg-3');
  try {
    const cwd = join(tmp.path, 'headless-cwd');
    const store = new HeadlessSessionStore(join(tmp.path, 's.json'));
    await store.load();
    await store.set('C', 'T', { sid: 'sid-prior', lastSuccessAt: 50, lastBotMessageId: 'om_p' });
    const mgr = new HeadlessConfigManager({
      headlessCwd: cwd,
      httpUrl: 'http://127.0.0.1:38291/mcp',
      sessionStore: store,
      tokenMap: new SessionTokenMap(),
      promptPath: '/nope.md',
      tokenTtlMs: 600_000,
      absoluteTimeoutMs: 1_800_000,
      idleTimeoutMs: 300_000,
      nonceFactory: () => 'n2',
    });
    await mgr.ensureCwd();
    const ctx = await mgr.prepareSpawn({ chatId: 'C', threadId: 'T', openId: 'U', now: 100 });
    assert.equal(ctx.sid, 'sid-prior');
  } finally {
    tmp.cleanup();
  }
});

test('releaseSpawn revokes token', async () => {
  const tmp = makeTmpDir('hcfg-4');
  try {
    const cwd = join(tmp.path, 'headless-cwd');
    const store = new HeadlessSessionStore(join(tmp.path, 's.json'));
    await store.load();
    const tokenMap = new SessionTokenMap();
    const mgr = new HeadlessConfigManager({
      headlessCwd: cwd,
      httpUrl: 'http://127.0.0.1:38291/mcp',
      sessionStore: store,
      tokenMap,
      promptPath: '/nope.md',
      tokenTtlMs: 600_000,
      absoluteTimeoutMs: 1_800_000,
      idleTimeoutMs: 300_000,
      nonceFactory: () => 'nT',
    });
    await mgr.ensureCwd();
    await mgr.prepareSpawn({ chatId: 'C', threadId: null, openId: 'U', now: 0 });
    mgr.releaseSpawn('nT');
    assert.equal(tokenMap.resolve('nT', 1), null);
  } finally {
    tmp.cleanup();
  }
});
