<!-- Generated: 2026-05-11 | Files scanned: ~30 | Token estimate: ~700 -->

# Architecture

Single-app **Next.js 16 + Mastra** monorepo (pnpm). Local-only RPG runtime in active port from the OpenClaw skill suite — see `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md`.

## Boundaries

```
┌──────────────────────────────────────────────┐
│ Next.js app (src/app)                        │
│ ├── Player UI (chat/)         ─┐             │
│ └── API routes (api/chat)     ─┼─► Mastra    │
└────────────────────────────────┴─────────────┘
                                   │
                                   ▼
                         ┌──────────────────────┐
                         │ Mastra runtime       │
                         │ src/mastra/          │
                         │  ├ agents (LLM)      │
                         │  ├ tools (Zod I/O)   │
                         │  └ workflows (steps) │
                         └──────────┬───────────┘
                                    │
                  ┌─────────────────┼──────────────────┐
                  ▼                 ▼                  ▼
            LibSQL (default)  DuckDB (obs)      Vault (FS)
            mastra.db         mastra.duckdb     vaults/<slug>/
```

## Layers

| Layer            | Path              | Status                                                       |
| ---------------- | ----------------- | ------------------------------------------------------------ |
| App / UI         | `src/app/`        | Demo scaffolding (chat page wired)                           |
| API edge         | `src/app/api/`    | `POST/GET /api/chat` (stream + history)                      |
| Mastra runtime   | `src/mastra/`     | Weather agent/tool/workflow (starter)                        |
| Vault domain lib | `src/lib/vault/`  | **Wave-1 ported** — paths/frontmatter/wikilinks/xml/entities |
| Test fixtures    | `tests/fixtures/` | Mirror vault folder layout                                   |
| Live vault       | `vaults/<slug>/`  | `commodore-vex` (single campaign)                            |

## Data flow (chat request)

```
Browser useChat() ──► POST /api/chat ──► handleChatStream({mastra, agentId})
                                              │
                                              ├─► Agent.stream() ──► OpenAI
                                              ├─► tools.weatherTool ──► open-meteo
                                              └─► Memory (LibSQL thread/resource)
        ◄── SSE UIMessageStream ◄────────────┘
```

`GET /api/chat` rehydrates prior turns via `agent.getMemory().recall(thread, resource)`.

## Port wave status

- **Wave-1 (DONE):** vault parsers in `src/lib/vault/` (frontmatter, paths, wikilinks, xml, entities) with sibling `*.test.ts` files.
- **Wave-2 (active branch):** runtime port design — `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-2`. Workflow `turn.ts`, `/api/turn` SSE, alias registry. Specs in `docs/superpowers/`.

## Key entry points

- `src/mastra/index.ts` — Mastra instance (workflows, agents, storage, observability)
- `src/app/api/chat/route.ts` — chat SSE bridge
- `src/app/layout.tsx` / `src/app/page.tsx` / `src/app/chat/page.tsx` — Next App Router shell
