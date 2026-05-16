<!-- Generated: 2026-05-16 | Files scanned: package.json | Token estimate: ~750 -->

# Dependencies

Runtime requires Node `>=22.13.0`, pnpm.

## Mastra stack

| Package                         | Role                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `@mastra/core` ^1.32.1          | Agents, tools, `createWorkflow`/`createStep`, composite storage     |
| `@mastra/libsql` ^1.10.0        | LibSQLStore (primary storage)                                       |
| `@mastra/duckdb` ^1.3.0         | DuckDBStore (observability traces)                                  |
| `@mastra/loggers` ^1.1.1        | PinoLogger                                                          |
| `@mastra/observability` ^1.11.1 | Exporters + SensitiveDataFilter                                     |
| `@mastra/ai-sdk` ^1.4.1         | `handleChatStream` + `toAISdkV5Messages` (used in stale chat route) |
| `mastra` ^1.8.1                 | CLI / Studio                                                        |

`@mastra/memory` is **no longer a direct dependency** (the journal file IS the memory for the turn workflow).

## AI / model SDKs

| Package               | Use                                                                              |
| --------------------- | -------------------------------------------------------------------------------- |
| `ai` ^6.0.177         | Vercel AI SDK (`createUIMessageStreamResponse`) — only used by stale `/api/chat` |
| `@ai-sdk/openai` ^3   | OpenAI chat model wiring (model spec `openai/gpt-5.5`)                           |
| `@ai-sdk/react` ^3    | `useChat` hook (only used in stale `/chat` page; `/play/[slug]` uses raw fetch)  |
| `openai` ^6.37.0      | Image generation (`gpt-image-2`) via `src/lib/media/image.ts`                    |
| `@inworld/tts` ^1.1.1 | TTS (`inworld-tts-2`) via `src/lib/media/tts.ts` (wired into turn workflow)      |

All three agents (`narrator`, `faction`, `illustrator`) target the `openai/gpt-5.5` model spec with `reasoningEffort: 'high'`.

## App framework

- `next@16.2.6`, `react@19.2.4`, `react-dom@19.2.4`
- `typescript@^5`, `eslint@^9`, `eslint-config-next`

## UI

| Package                                                          | Use                                 |
| ---------------------------------------------------------------- | ----------------------------------- |
| `tailwindcss@^4`, `@tailwindcss/postcss`                         | styling                             |
| `tw-animate-css`                                                 | animations                          |
| `class-variance-authority`, `clsx`, `tailwind-merge`             | `cn()` helper                       |
| `radix-ui`, `@radix-ui/react-use-controllable-state`             | shadcn primitives                   |
| `cmdk`                                                           | command palette                     |
| `embla-carousel-react`                                           | carousel                            |
| `lucide-react`, `@hugeicons/react`, `@hugeicons/core-free-icons` | icons                               |
| `motion`                                                         | animation                           |
| `@xyflow/react`                                                  | node-flow graphs                    |
| `@rive-app/react-webgl2`                                         | Rive animations                     |
| `media-chrome`                                                   | media player chrome (audio-player)  |
| `shadcn`                                                         | CLI                                 |
| `react-jsx-parser`                                               | runtime JSX rendering for artifacts |

## Markdown / streaming

- `streamdown`, `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`
- `shiki` (syntax highlighting)
- `ansi-to-react`
- `gray-matter` (vault frontmatter)
- `fast-xml-parser` (vault XML round-trip)
- `tokenlens` (token counting)
- `use-stick-to-bottom` (chat scroll)
- `nanoid`

## Validation

- `zod@^4.4.3` — tool I/O schemas (`createTool`), agent `structuredOutput` schemas (`src/lib/schemas.ts`), turn-workflow input/output schemas, and `/api/turn` request-body validation

## Tooling

- `vitest@^4.1.5` + `@vitest/coverage-v8` (`vitest.config.ts` enforces a coverage gate)
- `prettier@^3.8.3`, `eslint-config-prettier`
- `husky@^9`, `lint-staged@^17` (`.husky/pre-commit` → prettier + eslint --fix on staged files)

## External services

| Service             | Used for                                                                    | Auth                        |
| ------------------- | --------------------------------------------------------------------------- | --------------------------- |
| OpenAI Chat         | All three agents (`openai/gpt-5.5`)                                         | `OPENAI_API_KEY`            |
| OpenAI Images       | `image` tool (`gpt-image-2`, quality `'high'`)                              | `OPENAI_API_KEY`            |
| Inworld TTS         | `src/lib/media/tts.ts` (`inworld-tts-2`, OGG Opus); called by turn workflow | `INWORLD_API_KEY`           |
| Mastra Cloud (opt.) | Studio observability export                                                 | `MASTRA_CLOUD_ACCESS_TOKEN` |

## Environment variables

| Var                         | Required for                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`            | Any agent call; `image` tool                                                                                        |
| `INWORLD_API_KEY`           | Narrator audio (`ttsRender` inside the turn workflow)                                                               |
| `VAULT_SLUG`                | `loadEntity` + `image` tool default vault root                                                                      |
| `MASTRA_CLOUD_ACCESS_TOKEN` | Cloud observability export (optional)                                                                               |
| `RPG_RUNNER_MOCK`           | When `'1'`, `src/lib/sse/runner.ts` dispatches to `mockRunTurn` (no LLM/API cost). Used for local UI dev and tests. |

## Hooks / automation

- `.claude/settings.json` — PostToolUse hook auto-runs Prettier on Write/Edit.
- `.husky/pre-commit` — Prettier + ESLint on staged files.
