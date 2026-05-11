<!-- Generated: 2026-05-11 | Files scanned: ~80 | Token estimate: ~700 -->

# Frontend

Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui. Single chat surface in v0.

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

## Component library

| Folder                        | Source                                                                         | Count |
| ----------------------------- | ------------------------------------------------------------------------------ | ----- |
| `src/components/ui/`          | shadcn primitives (button, card, dialog, …)                                    | ~30   |
| `src/components/ai-elements/` | AI Elements widgets (conversation, message, tool, reasoning, code-block, etc.) | ~50   |

`ai-elements` are not yet wired into `chat/page.tsx` — currently a plain message list. They are pre-installed for upcoming RPG turn UI (artifact, plan, conversation, prompt-input, etc.).

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

- RPG turn UI (artifacts panel, NPC sheet, faction trigger badge) — see Wave-2 spec
- Auth, multi-thread switcher, vault selector
- Streaming progress indicator beyond `status === 'streaming'`
