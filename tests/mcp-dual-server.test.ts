import { test } from 'node:test';
import { strict as assert } from 'node:assert';
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
