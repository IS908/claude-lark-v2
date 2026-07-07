import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionTokenMap } from './mcp-session-router.js';

export type RegisterTools = (server: Server, kind: 'stdio' | 'http', sessionToken: string | null) => void;

export interface DualServerOptions {
  registerTools: RegisterTools;
  tokenMap: SessionTokenMap;
  httpPort: number;
  /** Bind address for the HTTP server. Defaults to '127.0.0.1' in start(). */
  httpBind?: string;
  /** Set false in unit tests to skip process.stdin connect (avoids test runner hang). Default: true */
  enableStdio?: boolean;
}

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  server: Server;
  token: string;
}

const TOKEN_HEADER = 'x-lark-session-token';

export class DualMcpServer {
  private stdioServer: Server | null = null;
  private httpServer: HttpServer | null = null;
  private httpSessions = new Map<string, HttpSession>();

  constructor(private readonly opts: DualServerOptions) {}

  async start(): Promise<{ stdioServer: Server; httpPort: number }> {
    // ─── stdio ───
    this.stdioServer = new Server(
      { name: 'lark-stdio', version: '2.0.0' },
      { capabilities: { tools: {} } },
    );
    this.opts.registerTools(this.stdioServer, 'stdio', null);

    if (this.opts.enableStdio !== false) {
      await this.stdioServer.connect(new StdioServerTransport());
    }

    // ─── http ───
    this.httpServer = createServer((req, res) => {
      this.handleHttp(req, res).catch((err) => {
        console.error('[mcp-dual-server] unhandled http error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal server error' }));
        }
      });
    });

    // Default to loopback to prevent accidental LAN exposure if caller omits httpBind.
    const bind = this.opts.httpBind ?? '127.0.0.1';
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.opts.httpPort, bind, () => resolve());
    });
    const httpPort = (this.httpServer.address() as AddressInfo).port;

    return { stdioServer: this.stdioServer, httpPort };
  }

  async stop(): Promise<void> {
    for (const sess of this.httpSessions.values()) {
      try { await sess.transport.close(); } catch { /* ignore */ }
    }
    this.httpSessions.clear();

    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }

    if (this.stdioServer) {
      try { await this.stdioServer.close(); } catch { /* ignore */ }
      this.stdioServer = null;
    }
  }

  sessions(): number {
    return this.httpSessions.size;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = headerString(req.headers[TOKEN_HEADER]);
    if (!token) {
      respondJson(res, 401, { error: 'missing X-Lark-Session-Token' });
      return;
    }
    const caller = this.opts.tokenMap.resolve(token, Date.now());
    if (!caller) {
      respondJson(res, 401, { error: 'invalid or expired token' });
      return;
    }

    const existingSessionId = headerString(req.headers['mcp-session-id']);
    let session = existingSessionId ? this.httpSessions.get(existingSessionId) : undefined;

    if (session && session.token !== token) {
      respondJson(res, 403, { error: 'session/token mismatch' });
      return;
    }

    if (!session) {
      // New session: create a fresh Server + transport per PoC-2 pattern
      const server = new Server(
        { name: 'lark-http', version: '2.0.0' },
        { capabilities: { tools: {} } },
      );

      const capturedToken = token;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          // PoC-2 verified: this callback fires reliably after initialize handshake
          this.httpSessions.set(sid, { transport, server, token: capturedToken });
        },
      });

      transport.onclose = () => {
        for (const [sid, sess] of this.httpSessions.entries()) {
          if (sess.transport === transport) {
            this.httpSessions.delete(sid);
            break;
          }
        }
      };

      this.opts.registerTools(server, 'http', capturedToken);
      await server.connect(transport);

      session = { transport, server, token: capturedToken };
    }

    await session.transport.handleRequest(req, res);
  }
}

function headerString(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
