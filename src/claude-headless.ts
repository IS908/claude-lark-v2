import { spawn } from 'node:child_process';
import type { SpawnContext } from './claude-headless-config.js';
import { classifyExit, type ErrorClass } from './claude-headless-error.js';
import { loadAppendSystemPrompt } from './claude-headless-prompts.js';

/** Default cap on a single un-newline-terminated stdout run (10 MiB). */
const DEFAULT_MAX_STDOUT_LINE_BYTES = 10 * 1024 * 1024;

export interface StreamEvent {
  type: string;
  raw: unknown;
  sessionId?: string;
}

export interface RunResult {
  sessionId: string | null;
  usage: unknown | null;
  finalText: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  errorClass: ErrorClass;
}

export interface RunOptions {
  ctx: SpawnContext;
  envelope: string;
  turnId: string;
  binary?: string;
  onStreamEvent?: (e: StreamEvent) => void;
  onStderr?: (chunk: string) => void;
  abortSignal?: AbortSignal;
  /** Single-line stdout cap in bytes. Default 10 MiB. Set lower in tests. */
  maxStdoutLineBytes?: number;
}

interface ResultEvent {
  type: string;
  session_id?: string;
  usage?: unknown;
  result?: string;
  stop_reason?: string;
}

export async function runHeadlessClaude(opts: RunOptions): Promise<RunResult> {
  const bin = opts.binary ?? process.env.CLAUDE_BIN ?? 'claude';
  // --append-system-prompt takes prompt TEXT, not a file path — load the file
  // content (falls back to the inline routing prompt on ENOENT).
  const appendPrompt = await loadAppendSystemPrompt(opts.ctx.appendSystemPromptPath);
  // NOTE: --strict-mcp-config was tested in PoC-5 (2026-06-28) and found ineffective
  // on current Claude Code builds. MCP isolation relies solely on env/cwd context
  // prepared by HeadlessConfigManager. Do not add it back without re-verifying.
  const args: string[] = [
    '-p',
    '--mcp-config', opts.ctx.mcpConfigPath,
    '--append-system-prompt', appendPrompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--input-format', 'text',
    '--verbose',
  ];
  if (opts.ctx.sid) {
    args.push('--resume', opts.ctx.sid);
  }
  // envelope is appended as the last positional prompt arg
  args.push(opts.envelope);

  const child = spawn(bin, args, {
    cwd: opts.ctx.cwd,
    env: opts.ctx.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const maxLineBytes = opts.maxStdoutLineBytes ?? DEFAULT_MAX_STDOUT_LINE_BYTES;

  let sessionId: string | null = null;
  let usage: unknown | null = null;
  let finalText: string | null = null;
  let stderrBuf = '';
  let stdoutBuf = '';

  const abortHandler = () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 1500);
    killTimer.unref?.();
  };
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      abortHandler();
    } else {
      opts.abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  child.stdout?.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    // Cap: if a single un-terminated run exceeds maxLineBytes, kill immediately to avoid OOM.
    if (stdoutBuf.length > maxLineBytes && stdoutBuf.indexOf('\n') < 0) {
      stderrBuf += `\n[runner] stdout single line exceeded ${maxLineBytes} bytes; killing child\n`;
      stdoutBuf = ''; // free memory before kill
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      return;
    }
    let idx: number;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line.trim()) continue;
      let evt: ResultEvent;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      const t = typeof evt.type === 'string' ? evt.type : 'unknown';
      const sid = typeof evt.session_id === 'string' ? evt.session_id : undefined;
      if (sid) sessionId = sid;
      if (t === 'result') {
        usage = evt.usage ?? null;
        if (typeof evt.result === 'string') finalText = evt.result;
      }
      opts.onStreamEvent?.({ type: t, raw: evt, sessionId: sid });
    }
  });

  child.stderr?.on('data', (chunk: string) => {
    stderrBuf += chunk;
    opts.onStderr?.(chunk);
  });

  let spawnError: Error | null = null;
  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (c, s) => resolve({ code: c, signal: s as NodeJS.Signals | null }));
    child.on('error', (err) => {
      // Spawn failure (e.g. binary not found): 'close' may never fire.
      // Must NOT fall through to classifyExit(null, null, …) === 'unknown',
      // which the delivery layer treats as success.
      spawnError = err;
      resolve({ code: null, signal: null });
    });
  });

  // Clean up abort listener if still registered
  if (opts.abortSignal && !opts.abortSignal.aborted) {
    opts.abortSignal.removeEventListener('abort', abortHandler);
  }

  if (spawnError) {
    stderrBuf += `\n[runner] spawn error: ${(spawnError as Error).message}\n`;
  }
  const errorClass = spawnError ? 'internal' : classifyExit(code, signal, stderrBuf);

  return {
    sessionId,
    usage,
    finalText,
    exitCode: code,
    signal,
    stderr: stderrBuf,
    errorClass,
  };
}
