import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface HttpTransportOptions {
  sessionIdGenerator: () => string;
  onClose?: () => void;
}

export function createHttpTransport(opts: HttpTransportOptions): StreamableHTTPServerTransport {
  const t = new StreamableHTTPServerTransport({
    sessionIdGenerator: opts.sessionIdGenerator,
  });
  if (opts.onClose) {
    const prev = t.onclose;
    t.onclose = () => {
      try { prev?.(); } catch { /* swallow */ }
      opts.onClose!();
    };
  }
  return t;
}
