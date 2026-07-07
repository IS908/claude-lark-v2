import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { HeadlessSessionStore } from './claude-headless-session-store.js';
import type { SessionTokenMap } from './mcp-session-router.js';

export interface SpawnContext {
  sid: string | null;
  token: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  mcpConfigPath: string;
  appendSystemPromptPath: string;
  absoluteDeadline: number;
  idleTimeoutMs: number;
}

export interface PrepareInput {
  chatId: string;
  threadId: string | null;
  openId: string;
  now: number;
}

export interface HeadlessConfigManagerOptions {
  headlessCwd: string;
  httpUrl: string;
  sessionStore: HeadlessSessionStore;
  tokenMap: SessionTokenMap;
  promptPath: string;
  tokenTtlMs: number;
  absoluteTimeoutMs: number;
  idleTimeoutMs: number;
  nonceFactory?: () => string;
}

function defaultNonce(): string {
  return randomBytes(16).toString('hex');
}

export class HeadlessConfigManager {
  private readonly nonceFactory: () => string;
  private cwdReady = false;

  constructor(private readonly opts: HeadlessConfigManagerOptions) {
    this.nonceFactory = opts.nonceFactory ?? defaultNonce;
  }

  async ensureCwd(): Promise<void> {
    if (this.cwdReady) return;
    await fsp.mkdir(this.opts.headlessCwd, { recursive: true });
    const mcpConfig = {
      mcpServers: {
        lark: {
          type: 'http',
          url: this.opts.httpUrl,
          headers: { 'X-Lark-Session-Token': '${LARK_CHILD_TOKEN}' },
        },
      },
    };
    const mcpConfigPath = join(this.opts.headlessCwd, '.mcp.json');
    await fsp.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf8');
    // Touch a .gitkeep so the dir survives empty.
    await fsp.writeFile(join(this.opts.headlessCwd, '.gitkeep'), '', 'utf8');
    this.cwdReady = true;
  }

  async prepareSpawn(input: PrepareInput): Promise<SpawnContext> {
    if (!this.cwdReady) await this.ensureCwd();
    const token = this.nonceFactory();
    // The token must outlive the turn: a TTL shorter than the absolute timeout
    // would 401 the child's MCP calls mid-turn. Clamp to the longer of the two.
    const tokenTtlMs = Math.max(this.opts.tokenTtlMs, this.opts.absoluteTimeoutMs);
    this.opts.tokenMap.register(
      token,
      { chatId: input.chatId, threadId: input.threadId, openId: input.openId },
      tokenTtlMs,
      input.now,
    );
    const prior = this.opts.sessionStore.get(input.chatId, input.threadId);
    // Strip Feishu credentials before passing env to child process.
    // Spec §3.2 Invariant 1: "Feishu credentials live only in the parent process."
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { LARK_APP_ID, LARK_APP_SECRET, LARK_OWNER_OPEN_ID,
            LARK_APP_ID_V2, LARK_APP_SECRET_V2, ...safeEnv } = process.env;
    const env: NodeJS.ProcessEnv = { ...safeEnv, LARK_CHILD_TOKEN: token };
    return {
      sid: prior?.sid ?? null,
      token,
      env,
      cwd: this.opts.headlessCwd,
      mcpConfigPath: join(this.opts.headlessCwd, '.mcp.json'),
      appendSystemPromptPath: this.opts.promptPath,
      absoluteDeadline: input.now + this.opts.absoluteTimeoutMs,
      idleTimeoutMs: this.opts.idleTimeoutMs,
    };
  }

  releaseSpawn(token: string): void {
    this.opts.tokenMap.revoke(token);
  }
}
