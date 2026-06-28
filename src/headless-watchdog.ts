import type { TurnObligationTracker } from './turn-obligation.js';

export interface WatchdogOptions {
  tracker: TurnObligationTracker;
  intervalMs: number;
  now?: () => number;
  onFallback: (turnId: string, reason: 'timeout_absolute' | 'timeout_idle') => Promise<void>;
}

export class HeadlessWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly nowFn: () => number;

  constructor(private readonly opts: WatchdogOptions) {
    this.nowFn = opts.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tickOnce().finally(() => { this.running = false; });
    }, this.opts.intervalMs);
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tickOnce(now?: number): Promise<void> {
    const t = now ?? this.nowFn();
    for (const o of this.opts.tracker.list()) {
      if (o.closed) continue;
      try {
        if (t > o.absoluteDeadline) {
          await this.opts.onFallback(o.turnId, 'timeout_absolute');
        } else if (t - o.lastStreamEventAt > o.idleTimeoutMs) {
          await this.opts.onFallback(o.turnId, 'timeout_idle');
        }
      } catch (err) {
        // A single fallback failure must not abort the rest of the tick.
        console.error('[watchdog] onFallback error for turn', o.turnId, err);
      }
    }
  }
}
