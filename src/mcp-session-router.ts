export interface CallerContext {
  chatId: string;
  threadId: string | null;
  openId: string;
}

interface TokenEntry {
  ctx: CallerContext;
  expiresAt: number;
}

export class SessionTokenMap {
  private map = new Map<string, TokenEntry>();

  register(token: string, ctx: CallerContext, ttlMs: number, now: number): void {
    this.map.set(token, { ctx, expiresAt: now + ttlMs });
  }

  resolve(token: string, now: number): CallerContext | null {
    const e = this.map.get(token);
    if (!e) return null;
    if (e.expiresAt < now) {
      this.map.delete(token);
      return null;
    }
    return e.ctx;
  }

  revoke(token: string): void {
    this.map.delete(token);
  }

  purgeExpired(now: number): number {
    let n = 0;
    for (const [token, e] of this.map.entries()) {
      if (e.expiresAt < now) {
        this.map.delete(token);
        n++;
      }
    }
    return n;
  }

  size(): number {
    return this.map.size;
  }
}
