import { spawn } from 'node:child_process';
import type { SpawnContext } from './claude-headless-config.js';
import { classifyExit, type ErrorClass } from './claude-headless-error.js';

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
  const args: string[] = [
    '-p',
    '--strict-mcp-config',
    '--mcp-config', opts.ctx.mcpConfigPath,
    '--append-system-prompt', opts.ctx.appendSystemPromptPath,
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

  let sessionId: string | null = null;
  let usage: unknown | null = null;
  let finalText: string | null = null;
  let stderrBuf = '';
  let stdoutBuf = '';

  const abortHandler = () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 1500);
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

  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('close', (c, s) => resolve({ code: c, signal: s as NodeJS.Signals | null }));
    child.on('error', () => resolve({ code: null, signal: null }));
  });

  // Clean up abort listener if still registered
  if (opts.abortSignal && !opts.abortSignal.aborted) {
    opts.abortSignal.removeEventListener('abort', abortHandler);
  }

  const errorClass = classifyExit(code, signal, stderrBuf);

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
