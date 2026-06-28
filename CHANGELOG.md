# Changelog

All notable changes to **claude-lark-v2** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Architecture

v2.0.0 切换为 **headless fork 模型**：每条飞书消息 fork 一个独立的 `claude -p --resume <sid>` 子进程，
通过本地 Streamable HTTP MCP 连回父进程调原有 lark 工具。每个 `(chat_id, thread_id)` 独立 Claude session，
线程间彻底隔离。详见本地 spec 文档 `docs/superpowers/specs/2026-06-28-headless-fork-session-isolation-design.md`（gitignored）。

### M1 — Foundation

新增 13 个独立可测的 `src/*.ts` 模块 + 单元测试 + 测试 infra：

- **Foundation 层**：`turn-obligation` / `per-turn-log` / `claude-headless-session-store` / `claude-headless-error` / `claude-headless-prompts` + `prompts/feishu-routing.md`
- **MCP 层**：`mcp-http-transport` / `mcp-session-router` / `mcp-dual-server`（双实例 + per-session HTTP 工厂；含 401/403 鉴权与 session/token 绑定校验）
- **Runner 层**：`claude-headless-config` / `claude-headless`（stream-json 解析 + AbortSignal kill）
- **应用层**：`inbound-turn-pipeline` / `headless-watchdog` / `claude-headless-delivery`

**测试**：52 个 node:test 单元测试全部通过。`npm run test:unit` 是新增的测试 gate（绕开 `npm test` 中预存的 audit CVE 失败）。

**Plugin 改名**：`.claude-plugin/plugin.json` / `marketplace.json` / `.mcp.json` 中的 `lark` → `lark-v2`。**装 `lark-v2` 前先禁用 `lark`** —— 两个 plugin 共享 `~/.claude/channels/lark/` 数据目录，同时启用会争抢同一份 config / memory / jobs / 锁。

### M2–M5（未开始）

- **M2**：改写 `channel.ts` / `tools.ts` / `index.ts` / `scheduler.ts`，抽 `memory-enricher.ts`，删 `mcpServerInstructions`；接通 M1 模块到入站 / 出站链路
- **M3**：集成测试（mock Feishu WSS + 真 fork）—— 8 个场景
- **M4**：删除 v1.x 嵌入式路径 —— `enrichment-dedup.ts` / `session-health.ts` / `hooks/enforce-lark-reply.mjs` / Stop hook 配置 / `mcpServerInstructions`
- **M5**：v2.0.0 release —— bump 三个版本号 + 1 周 dogfood

---

## v1.x History

v1.0.0 – v1.3.2 的完整 changelog 保留在原仓库 [IS908/claude-lark-plugin](https://github.com/IS908/claude-lark-plugin)。
本仓库初始 commit `bf70706` 是 v1.3.2 的扁平化 snapshot（删除了一个 GitHub secret-scanning 误报的 L1 regex 测试 fixture 文件 `scripts/privacy-rules-smoke.ts`），作为 v2 fork 架构改造的起点。
