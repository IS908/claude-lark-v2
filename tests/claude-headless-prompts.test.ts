import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from './_setup.js';
import { loadAppendSystemPrompt, defaultAppendSystemPrompt } from '../src/claude-headless-prompts.js';

test('loadAppendSystemPrompt returns file content', async () => {
  const tmp = makeTmpDir('prompt');
  try {
    const p = join(tmp.path, 'prompt.md');
    writeFileSync(p, 'hello prompt');
    const got = await loadAppendSystemPrompt(p);
    assert.equal(got, 'hello prompt');
  } finally {
    tmp.cleanup();
  }
});

test('loadAppendSystemPrompt falls back when file missing', async () => {
  const got = await loadAppendSystemPrompt('/nonexistent/path.md');
  assert.match(got, /Feishu/);
});

test('default prompt mentions key tools and warns against IBKR/telegram', () => {
  const p = defaultAppendSystemPrompt();
  assert.match(p, /reply/);
  assert.match(p, /Interactive Brokers/);
  assert.match(p, /telegram/);
});
