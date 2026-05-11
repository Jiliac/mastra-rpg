<!-- Generated: 2026-05-11 | Files scanned: ~15 | Token estimate: ~600 -->

# Backend

Next.js App Router + Mastra in-process runtime. No separate server.

## Routes

| Method | Path        | Handler                          | Purpose                            |
| ------ | ----------- | -------------------------------- | ---------------------------------- |
| POST   | `/api/chat` | `src/app/api/chat/route.ts:POST` | Stream agent response (UIMessage)  |
| GET    | `/api/chat` | `src/app/api/chat/route.ts:GET`  | Recall thread memory for hydration |

```
POST /api/chat → handleChatStream({mastra, agentId:'weather-agent', memory:{thread,resource}})
              → createUIMessageStreamResponse  ─► SSE

GET  /api/chat → mastra.getAgentById('weather-agent').getMemory().recall(...)
              → toAISdkV5Messages              ─► JSON
```

`THREAD_ID` and `RESOURCE_ID` are hardcoded constants (v0 single-user).

## Mastra runtime (src/mastra/)

```
index.ts (Mastra instance)
 ├─ workflows.weatherWorkflow ─► workflows/weather-workflow.ts
 │    └─ steps: fetchWeather → planActivities
 ├─ agents.weatherAgent       ─► agents/weather-agent.ts
 │    ├─ model: openai/gpt-5.5
 │    ├─ tools: { weatherTool }
 │    └─ memory: new Memory() (LibSQL-backed)
 ├─ storage: MastraCompositeStore
 │    ├─ default: LibSQLStore(file:./mastra.db)
 │    └─ domains.observability: DuckDBStore
 ├─ logger: PinoLogger
 └─ observability: DefaultExporter + CloudExporter + SensitiveDataFilter
```

## Tools

| Tool          | File                               | I/O schema (Zod)            |
| ------------- | ---------------------------------- | --------------------------- |
| `get-weather` | `src/mastra/tools/weather-tool.ts` | `{location}` → forecast obj |

Calls open-meteo geocoding + forecast APIs.

## Vault domain library (`src/lib/vault/`)

Pure FS/parsing layer — no Mastra coupling.

```
paths.ts        path helpers (vaultRoot, *Path, *Dir)
frontmatter.ts  parseFrontmatter(raw) → {frontmatter, body}   (gray-matter)
wikilinks.ts    parseWikilinks / resolveWikilink / stripForTts
xml.ts          parseWorldXml / parseThreadsXml / parseCharacterXml  (fast-xml-parser, preserveOrder)
entities.ts     loadNpc / loadFaction / loadLocation / listFactions / loadAlwaysLoaded
```

`loadAlwaysLoaded(root)` parallel-loads `WorldView`, `CharacterView`, `ThreadView[]`, zero-map, style-guide, and all factions — the "always-loaded" context bundle planned for the GM workflow.

## Key files

- `src/mastra/index.ts` (46 LOC) — singleton Mastra config
- `src/app/api/chat/route.ts` (43 LOC) — SSE chat bridge
- `src/mastra/workflows/weather-workflow.ts` (184 LOC) — example two-step workflow
- `src/lib/vault/xml.ts` (207 LOC) — XML round-trip parsers
- `src/lib/vault/entities.ts` (91 LOC) — entity loaders

## External services

- OpenAI (via Mastra `openai/gpt-5.5` model spec)
- open-meteo geocoding + forecast (no key)
- Mastra Cloud (optional, if `MASTRA_CLOUD_ACCESS_TOKEN` set)
