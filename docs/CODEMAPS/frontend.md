<!-- Generated: 2026-05-15 | Files scanned: ~85 | Token estimate: ~650 -->

# Frontend

Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui. Single chat surface, currently wired to a stale weather-agent route — needs a UI rebuild in Wave 6.

## Page tree

```
src/app/
├── layout.tsx       Root layout — fonts (Geist, Figtree), <html> + <body>
├── globals.css      Tailwind v4 entry
├── page.tsx         Home — create-next-app scaffold (placeholder)
└── chat/page.tsx    'use client' — useChat() → /api/chat (Weather Chat)
```

## Chat page flow

```
ChatPage (chat/page.tsx)
 │ useChat({ transport: DefaultChatTransport('/api/chat') })
 │ useEffect → fetch('/api/chat') → setMessages(history)
 │
 ├─ <ul> messages.map → role-aligned bubbles, parts[].type==='text'
 └─ <form onSubmit> → sendMessage({text})    (disabled while streaming)
```

State source: `@ai-sdk/react` `useChat()` (messages, status, sendMessage, setMessages).

**Note:** `/api/chat` references the removed `weather-agent` (see `backend.md`); the chat page will fail at runtime until Wave 5 lands `/api/turn` and the page is rewired (Wave 6 — RPG turn UI).

## Component library

| Folder                        | Source                                                                         | Count |
| ----------------------------- | ------------------------------------------------------------------------------ | ----- |
| `src/components/ui/`          | shadcn primitives (button, card, dialog, …)                                    | ~30   |
| `src/components/ai-elements/` | AI Elements widgets (conversation, message, tool, reasoning, code-block, etc.) | ~50   |

`ai-elements` are pre-installed but not yet wired into `chat/page.tsx` — reserved for the upcoming RPG turn UI (artifact panel, image embeds, dice/tool call rendering, faction badges, etc.).

## Styling

- Tailwind v4 (`@tailwindcss/postcss`)
- `tw-animate-css` for keyframes
- `class-variance-authority` + `clsx` + `tailwind-merge` via `src/lib/utils.ts` (`cn()`)
- Three fonts: Geist Sans, Geist Mono, Figtree (CSS variables `--font-*`)

## Conventions

- Imports use `@/` path alias (`tsconfig.json` baseUrl)
- All client components declare `'use client'` at top
- Tailwind dark-mode via `dark:` variants (no theme provider yet)

## Not yet implemented

- RPG turn UI (artifact pane, NPC sheet, faction trigger badge, image embeds, journal viewer)
- Auth, multi-thread switcher, vault selector
- Streaming progress UI beyond `status === 'streaming'`
- Replacement of `/api/chat` consumer with `/api/turn` (Wave 5/6)
