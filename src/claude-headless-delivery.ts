import type { TurnObligationTracker } from './turn-obligation.js';
import type { HeadlessSessionStore } from './claude-headless-session-store.js';
import type { HeadlessConfigManager } from './claude-headless-config.js';
import type { InboundTurn } from './inbound-turn-pipeline.js';
import { runHeadlessClaude, type RunResult } from './claude-headless.js';
import { randomBytes } from 'node:crypto';

export interface FallbackHandler {
  onAbsoluteTimeout(turn: InboundTurn): Promise<void>;
  onIdleTimeout(turn: InboundTurn): Promise<void>;
  onCrash(turn: InboundTurn, result: RunResult): Promise<void>;
  onSuccess(turn: InboundTurn, result: RunResult): Promise<void>;
}

export interface DeliveryOptions {
  tracker: TurnObligationTracker;
  sessionStore: HeadlessSessionStore;
  config: HeadlessConfigManager;
  runner?: typeof runHeadlessClaude;
  semaphore: { acquire(): Promise<() => void> };
  envelope: (turn: InboundTurn) => string;
  turnIdFactory?: () => string;
  handler: FallbackHandler;
  now?: () => number;
}

function defaultTurnId(): string {
  return randomBytes(8).toString('hex');
}

export class HeadlessDelivery {
  private readonly runner: typeof runHeadlessClaude;
  private readonly nowFn: () => number;
  private readonly turnIdFactory: () => string;
  // turnMap is package-internal for watchdog wiring; accessed by handleFallback and tests.
  readonly turnMap = new Map<string, InboundTurn>();
  // abortControllers lets handleFallback SIGTERM the in-flight runner on watchdog timeout.
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly opts: DeliveryOptions) {
    this.runner = opts.runner ?? runHeadlessClaude;
    this.nowFn = opts.now ?? Date.now;
    this.turnIdFactory = opts.turnIdFactory ?? defaultTurnId;
  }

  async deliver(turn: InboundTurn): Promise<void> {
    const release = await this.opts.semaphore.acquire();
    const turnId = this.turnIdFactory();
    this.turnMap.set(turnId, turn);
    let spawnToken = '';
    try {
      const now = this.nowFn();
      const ctx = await this.opts.config.prepareSpawn({
        chatId: turn.chatId,
        threadId: turn.threadId,
        openId: turn.openId,
        now,
      });
      // Hold token for releaseSpawn; M2 wiring passes ctx.token here via closure.
      spawnToken = ctx.token;

      this.opts.tracker.open({
        turnId,
        chatId: turn.chatId,
        threadId: turn.threadId,
        openId: turn.openId,
        startedAt: now,
        absoluteDeadline: ctx.absoluteDeadline,
        idleTimeoutMs: ctx.idleTimeoutMs,
        requireReply: turn.requireReply,
      });

      const ac = new AbortController();
      this.abortControllers.set(turnId, ac);

      try {
        const result = await this.runner({
          ctx,
          envelope: this.opts.envelope(turn),
          turnId,
          abortSignal: ac.signal,
          onStreamEvent: () => {
            this.opts.tracker.touchStreamEvent(turnId, this.nowFn());
          },
        });

        if (result.errorClass === 'crash' || result.errorClass === 'internal') {
          if (this.opts.tracker.tryCloseFailed(turnId, result.errorClass)) {
            await this.opts.handler.onCrash(turn, result);
          }
        } else {
          // errorClass === 'unknown' => success path (runner may return 'unknown' for clean exits)
          if (this.opts.tracker.tryCloseSuccess(turnId, result.sessionId)) {
            if (result.sessionId) {
              await this.opts.sessionStore.set(turn.chatId, turn.threadId, {
                sid: result.sessionId,
                lastSuccessAt: this.nowFn(),
                lastBotMessageId: this.opts.tracker.get(turnId)?.lastMessageId ?? null,
              });
            }
            await this.opts.handler.onSuccess(turn, result);
          }
        }
      } catch (err) {
        // An unexpected throw (runner bug, store I/O, handler failure) must not
        // leave the obligation open forever: the finally block below deletes
        // turnMap, so a later watchdog fallback would no-op and the open
        // obligation would make every tick fire until process restart.
        this.opts.tracker.tryCloseFailed(turnId, `unexpected: ${String(err)}`);
        throw err;
      }
    } finally {
      // releaseSpawn is keyed by token. M1: spawnToken is set after prepareSpawn succeeds.
      // If prepareSpawn throws before token is assigned, spawnToken stays '' which is a no-op
      // revoke (TokenMap.revoke on unknown key is benign). M2 will tighten this closure.
      this.opts.config.releaseSpawn(spawnToken);
      release();
      this.turnMap.delete(turnId);
      this.abortControllers.delete(turnId);
    }
  }

  async handleFallback(turnId: string, reason: 'timeout_absolute' | 'timeout_idle'): Promise<void> {
    const turn = this.turnMap.get(turnId);
    if (!turn) {
      // Defensive: the turn is gone from turnMap but the obligation may still
      // be open (e.g. crash between open() and the deliver catch). Close it so
      // the watchdog does not re-fire on it every tick.
      this.opts.tracker.tryCloseFailed(turnId, reason);
      return;
    }
    if (reason === 'timeout_absolute') {
      if (this.opts.tracker.tryCloseFailed(turnId, reason)) {
        // Abort the in-flight runner (SIGTERM → SIGKILL) so the subprocess exits
        // and the semaphore slot is released. Must run after tryCloseFailed so the
        // obligation state is updated before the runner's finally block fires.
        this.abortControllers.get(turnId)?.abort();
        await this.opts.handler.onAbsoluteTimeout(turn);
      }
    } else {
      if (this.opts.tracker.tryCloseFailed(turnId, reason)) {
        this.abortControllers.get(turnId)?.abort();
        await this.opts.handler.onIdleTimeout(turn);
      }
    }
  }
}
