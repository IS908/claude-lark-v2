import { promises as fsp, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TurnLogWriter {
  append(line: string): Promise<void>;
  close(): Promise<void>;
  readonly path: string;
}

class FileTurnLogWriter implements TurnLogWriter {
  private closed = false;
  constructor(public readonly path: string) {}

  async append(line: string): Promise<void> {
    if (this.closed) return;
    await fsp.appendFile(this.path, line.endsWith('\n') ? line : line + '\n', 'utf8');
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 128) || '_';
  // Reject pure-dot segments (., .., ...) to prevent path traversal
  if (/^\.+$/.test(cleaned)) return '_';
  return cleaned;
}

export class PerTurnLogger {
  constructor(private readonly baseDir: string) {}

  open(chatId: string, threadId: string | null, ts: number): TurnLogWriter {
    const chatSeg = sanitizeSegment(chatId);
    const threadSeg = threadId == null ? '_root' : sanitizeSegment(threadId);
    const dir = join(this.baseDir, chatSeg, threadSeg);
    mkdirSync(dir, { recursive: true });
    return new FileTurnLogWriter(join(dir, `${ts}.log`));
  }
}
