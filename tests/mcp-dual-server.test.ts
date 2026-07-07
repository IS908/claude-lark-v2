import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DualMcpServer } from '../src/mcp-dual-server.js';
import { SessionTokenMap } from '../src/mcp-session-router.js';

test('HTTP client can call a tool registered via registerTools', async () => {
  const tokenMap = new SessionTokenMap();
  tokenMap.register('test-token', { chatId: 'C', threadId: null, openId: 'U' }, 60_000, Date.now());

  let callCount = 0;
  const registerTools = (server: Server, kind: 'stdio' | 'http', token: string | null) => {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      callCount++;
      return { content: [{ type: 'text', text: `kind=${kind} token=${token ?? 'none'} n=${callCount}` }] };
    });
  };

  const dual = new DualMcpServer({
    registerTools,
    tokenMap,
    httpPort: 0,
    httpBind: '127.0.0.1',
    enableStdio: false,
  });
  const { httpPort } = await dual.start();

  try {
    const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`), {
      requestInit: { headers: { 'X-Lark-Session-Token': 'test-token' } },
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(t);
    const r = await client.callTool({ name: 'echo', arguments: {} });
    const txt = ((r as any).content?.[0]?.text as string) ?? '';
    assert.match(txt, /kind=http/);
    assert.match(txt, /token=test-token/);
    await client.close();
  } finally {
    await dual.stop();
  }
});

test('start returns httpPort and sessions()=0 initially', async () => {
  const dual = new DualMcpServer({
    registerTools: () => {},
    tokenMap: new SessionTokenMap(),
    httpPort: 0,
    httpBind: '127.0.0.1',
    enableStdio: false,
  });
  const { httpPort } = await dual.start();
  try {
    assert.ok(httpPort > 0);
    assert.equal(dual.sessions(), 0);
  } finally {
    await dual.stop();
  }
});

function postMcp(
  port: number,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('missing token header → 401', async () => {
  const dual = new DualMcpServer({
    registerTools: () => {},
    tokenMap: new SessionTokenMap(),
    httpPort: 0,
    httpBind: '127.0.0.1',
    enableStdio: false,
  });
  const { httpPort } = await dual.start();

  try {
    const { status } = await postMcp(httpPort, {}, { jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 });
    assert.equal(status, 401);
  } finally {
    await dual.stop();
  }
});

test('invalid token → 401', async () => {
  const dual = new DualMcpServer({
    registerTools: () => {},
    tokenMap: new SessionTokenMap(),
    httpPort: 0,
    httpBind: '127.0.0.1',
    enableStdio: false,
  });
  const { httpPort } = await dual.start();

  try {
    const { status } = await postMcp(
      httpPort,
      { 'x-lark-session-token': 'invalid-token' },
      { jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 },
    );
    assert.equal(status, 401);
  } finally {
    await dual.stop();
  }
});

test('session hijack (token mismatch) → 403', async () => {
  const tokenMap = new SessionTokenMap();
  tokenMap.register('token-a', { chatId: 'C', threadId: null, openId: 'U' }, 60_000, Date.now());
  tokenMap.register('token-b', { chatId: 'C', threadId: null, openId: 'U' }, 60_000, Date.now());

  let sessionIdCapture: string | undefined;
  const registerTools = (server: Server) => {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
    }));
  };

  const dual = new DualMcpServer({
    registerTools,
    tokenMap,
    httpPort: 0,
    httpBind: '127.0.0.1',
    enableStdio: false,
  });
  const { httpPort } = await dual.start();

  try {
    // First, create a session with token-a
    const t1 = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`), {
      requestInit: { headers: { 'X-Lark-Session-Token': 'token-a' } },
    });
    const client1 = new Client({ name: 'client1', version: '0.0.0' }, { capabilities: {} });
    await client1.connect(t1);

    // Extract the session ID from the transport (internals; this is a test detail)
    sessionIdCapture = (t1 as any).sessionId;
    await client1.close();

    // Now try to hijack with token-b, providing the same session ID
    if (sessionIdCapture) {
      const { status } = await postMcp(
        httpPort,
        {
          'x-lark-session-token': 'token-b',
          'mcp-session-id': sessionIdCapture,
        },
        { jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 },
      );
      assert.equal(status, 403, 'should reject token mismatch with 403');
    }
  } finally {
    await dual.stop();
  }
});
