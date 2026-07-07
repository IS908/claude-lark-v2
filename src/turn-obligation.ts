import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

export interface TurnObligation {
  turnId: string;
  chatId: string;
  threadId: string | null;
  openId: string;
  startedAt: number;
  absoluteDeadline: number;
  idleTimeoutMs: number;
  lastStreamEventAt: number;
  requireReply: boolean;
  hasReply: boolean;
  lastMessageId: string | null;
  sid: string | null;
  closed: boolean;
  success: boolean;
  reason: string | null;
}

export interface OpenInput {
  turnId: string;
  chatId: string;
  threadId: string | null;
  openId: string;
  startedAt: number;
  absoluteDeadline: number;
  idleTimeoutMs: number;
  requireReply: boolean;
}

export class TurnObligationTracker {
  private map = new Map<string, TurnObligation>();

  open(input: OpenInput): TurnObligation {
    const o: TurnObligation = {
      ...input,
      lastStreamEventAt: input.startedAt,
      hasReply: false,
      lastMessageId: null,
      sid: null,
      closed: false,
      success: false,
      reason: null,
    };
    this.map.set(o.turnId, o);
    return o;
  }

  touchStreamEvent(turnId: string, now: number): void {
    const o = this.map.get(turnId);
    if (!o || o.closed) return;
    o.lastStreamEventAt = now;
  }

  recordReply(turnId: string, messageId: string): void {
    const o = this.map.get(turnId);
    if (!o || o.closed) return;
    o.hasReply = true;
    o.lastMessageId = messageId;
  }

  tryCloseSuccess(turnId: string, sid: string | null): boolean {
    const o = this.map.get(turnId);
    if (!o || o.closed) return false;
    o.closed = true;
    o.success = true;
    o.sid = sid;
    return true;
  }

  tryCloseFailed(turnId: string, reason: string): boolean {
    const o = this.map.get(turnId);
    if (!o || o.closed) return false;
    o.closed = true;
    o.success = false;
    o.reason = reason;
    return true;
  }

  list(): TurnObligation[] {
    return Array.from(this.map.values());
  }

  get(turnId: string): TurnObligation | null {
    return this.map.get(turnId) ?? null;
  }

  async scanInflightDir(dir: string): Promise<TurnObligation[]> {
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const out: TurnObligation[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fsp.readFile(join(dir, name), 'utf8');
        const parsed = JSON.parse(raw) as TurnObligation;
        if (typeof parsed.turnId === 'string') out.push(parsed);
      } catch {
        // malformed file; skip
      }
    }
    return out;
  }
}
