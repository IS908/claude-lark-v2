import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';

export interface SessionEntry {
  sid: string;
  lastSuccessAt: number;
  lastBotMessageId: string | null;
}

function keyOf(chatId: string, threadId: string | null): string {
  return threadId == null ? `${chatId}\x00__null__` : `${chatId}\x00${threadId}`;
}

export class HeadlessSessionStore {
  private cache = new Map<string, SessionEntry>();
  private writeLock = Promise.resolve();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, SessionEntry>;
      for (const [k, v] of Object.entries(parsed)) {
        this.cache.set(k, v);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    this.loaded = true;
  }

  get(chatId: string, threadId: string | null): SessionEntry | null {
    return this.cache.get(keyOf(chatId, threadId)) ?? null;
  }

  async set(chatId: string, threadId: string | null, entry: SessionEntry): Promise<void> {
    const k = keyOf(chatId, threadId);
    this.cache.set(k, entry);
    // Serialize writes; chain on writeLock.
    // IMPORTANT: .catch() must resolve (not re-throw) so the chain stays alive.
    // If .catch() throws, writeLock becomes permanently rejected and all future
    // set() calls silently drop to disk — data loss with no visible error.
    this.writeLock = this.writeLock
      .then(() => this.flush())
      .catch((err) => {
        console.error('[session-store] flush error, skipping:', err);
        // Do not re-throw — keep the chain resolved.
      });
    await this.writeLock;
  }

  private async flush(): Promise<void> {
    const obj: Record<string, SessionEntry> = {};
    for (const [k, v] of this.cache.entries()) obj[k] = v;
    const dir = dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
    await fsp.rename(tmp, this.filePath);
  }
}
