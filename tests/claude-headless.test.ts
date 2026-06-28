import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './_setup.js';
import { runHeadlessClaude } from '../src/claude-headless.js';
import type { SpawnContext } from '../src/claude-headless-config.js';

function makeFakeBinary(dir: string, jsonl: string, exitCode = 0): string {
  const path = join(dir, 'fake-claude');
  // simple bash script that prints lines and exits
  const lines = jsonl.split('\n').filter(Boolean).map(l => `echo '${l}'`).join('\n');
  writeFileSync(path, `#!/usr/bin/env bash\n${lines}\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

function fakeCtx(cwd: string): SpawnContext {
  return {
    sid: null,
    token: 'tok',
    env: { ...process.env, LARK_CHILD_TOKEN: 'tok' },
    cwd,
    mcpConfigPath: join(cwd, '.mcp.json'),
    appendSystemPromptPath: '/nope.md',
    absoluteDeadline: Date.now() + 60_000,
    idleTimeoutMs: 30_000,
  };
}

test('parses stream-json and extracts sessionId + usage from type=result', async () => {
  const tmp = makeTmpDir('runner-1');
  try {
    const jsonl = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-A' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'result', session_id: 'sid-A', stop_reason: 'end_turn', usage: { input_tokens: 1 }, result: 'final text' }),
    ].join('\n');
    const bin = makeFakeBinary(tmp.path, jsonl, 0);
    const events: string[] = [];
    const res = await runHeadlessClaude({
      ctx: fakeCtx(tmp.path),
      envelope: 'ignored by fake',
      turnId: 'T1',
      binary: bin,
      onStreamEvent: (e) => events.push(e.type),
    });
    assert.equal(res.sessionId, 'sid-A');
    assert.equal(res.exitCode, 0);
    assert.equal(res.errorClass, 'unknown'); // exit 0 + no signal → unknown; success path is at delivery layer
    assert.equal(res.finalText, 'final text');
    assert.deepEqual(events, ['system', 'assistant', 'result']);
  } finally {
    tmp.cleanup();
  }
});

test('non-zero exit classifies as internal', async () => {
  const tmp = makeTmpDir('runner-2');
  try {
    const bin = makeFakeBinary(tmp.path, '', 1);
    const res = await runHeadlessClaude({
      ctx: fakeCtx(tmp.path),
      envelope: '',
      turnId: 'T2',
      binary: bin,
    });
    assert.equal(res.exitCode, 1);
    assert.equal(res.errorClass, 'internal');
    assert.equal(res.sessionId, null);
  } finally {
    tmp.cleanup();
  }
});

test('idle timeout via abortSignal kills child', async () => {
  const tmp = makeTmpDir('runner-3');
  try {
    // Fake binary that sleeps forever
    const bin = join(tmp.path, 'sleeper');
    writeFileSync(bin, `#!/usr/bin/env bash\nsleep 60\n`);
    chmodSync(bin, 0o755);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const res = await runHeadlessClaude({
      ctx: fakeCtx(tmp.path),
      envelope: '',
      turnId: 'T3',
      binary: bin,
      abortSignal: ac.signal,
    });
    assert.ok(res.signal === 'SIGTERM' || res.signal === 'SIGKILL' || (res.exitCode != null && res.exitCode !== 0));
    assert.equal(res.errorClass, 'crash');
  } finally {
    tmp.cleanup();
  }
});

test('stdoutBuf single-line cap kills child and results in crash', async () => {
  const tmp = makeTmpDir('runner-4');
  try {
    // Fake binary that writes 2000 bytes of 'A' with no newline, then exits cleanly.
    // With maxStdoutLineBytes=1024 the cap triggers before the process exits.
    const bin = join(tmp.path, 'bigline');
    writeFileSync(
      bin,
      `#!/usr/bin/env bash\npython3 -c "import sys; sys.stdout.write('A' * 2000); sys.stdout.flush()"\nexit 0\n`,
    );
    chmodSync(bin, 0o755);
    const res = await runHeadlessClaude({
      ctx: fakeCtx(tmp.path),
      envelope: '',
      turnId: 'T4',
      binary: bin,
      maxStdoutLineBytes: 1024,
    });
    // Child is killed via SIGKILL; classifyExit maps that to 'crash'.
    assert.equal(res.errorClass, 'crash', `expected crash, got ${res.errorClass} (stderr: ${res.stderr})`);
    assert.ok(
      res.stderr.includes('exceeded'),
      `expected "exceeded" in stderr, got: ${res.stderr}`,
    );
  } finally {
    tmp.cleanup();
  }
});
