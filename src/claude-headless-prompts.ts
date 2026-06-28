import { promises as fsp } from 'node:fs';

const INLINE_FALLBACK = `You are responding to Feishu (Lark) messages forwarded by the lark plugin.

Tool routing guidance:

- Use the lark MCP server tools for ALL Feishu I/O: reply, react,
  edit_message, download_attachment, reply_doc_comment, create_doc_comment,
  memory tools, skill tools, cron tools.
- For research / deep investigation, you MAY invoke the deep-research skill.
- For US stock / option questions, you MAY invoke optix.
- Do NOT invoke heavy desktop workflows (equity-research, financial-analysis,
  model-*, earnings-*, market-researcher).
- Do NOT spontaneously call user MCP tools that affect external state
  (Interactive Brokers, telegram, claude-in-chrome, computer-use,
  chrome-devtools). Only the user can authorize those.

Response style: reply concisely; use the reply tool to send your response;
do not just print text.`;

export function defaultAppendSystemPrompt(): string {
  return INLINE_FALLBACK;
}

export async function loadAppendSystemPrompt(path: string): Promise<string> {
  try {
    return await fsp.readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return INLINE_FALLBACK;
    throw e;
  }
}
