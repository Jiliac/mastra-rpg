<!-- Generated: 2026-05-11 | Files scanned: package.json | Token estimate: ~600 -->

# Dependencies

Runtime requires Node `>=22.13.0`, pnpm.

## Mastra stack

| Package                 | Role                                        |
| ----------------------- | ------------------------------------------- |
| `@mastra/core`          | Agents, workflows, tools, composite storage |
| `@mastra/memory`        | Thread/resource memory abstraction          |
| `@mastra/libsql`        | LibSQLStore (primary storage)               |
| `@mastra/duckdb`        | DuckDBStore (observability traces)          |
| `@mastra/loggers`       | PinoLogger                                  |
| `@mastra/observability` | Exporters + SensitiveDataFilter             |
| `@mastra/ai-sdk`        | `handleChatStream` + `toAISdkV5Messages`    |
| `mastra`                | CLI / Studio                                |

## AI SDK + model

- `ai@^6` (Vercel AI SDK)
- `@ai-sdk/openai`, `@ai-sdk/react` (`useChat`)
- Model spec: `openai/gpt-5.5` (in `weather-agent.ts`)

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
| `media-chrome`                                                   | media player chrome                 |
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

- `zod@^4` (tool I/O schemas + workflow step schemas)

## Tooling

- `vitest@^4` + `@vitest/coverage-v8` (test runner — see `vitest.config.ts`)
- `prettier@^3.8`, `eslint-config-prettier`
- `husky`, `lint-staged` (`.husky/pre-commit` → prettier + eslint --fix on staged files)

## External services

| Service               | Used for                    | Auth                        |
| --------------------- | --------------------------- | --------------------------- |
| OpenAI                | LLM (`openai/gpt-5.5`)      | `OPENAI_API_KEY`            |
| open-meteo (geo)      | Geocoding for weather tool  | none                        |
| open-meteo (forecast) | Forecast data               | none                        |
| Mastra Cloud (opt.)   | Studio observability export | `MASTRA_CLOUD_ACCESS_TOKEN` |

## Hooks / automation

- `.claude/settings.json` — PostToolUse hook auto-runs Prettier on Write/Edit.
- `.husky/pre-commit` — Prettier + ESLint on staged files.
