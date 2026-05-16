<!-- Generated: 2026-05-16 | Files scanned: ~95 | Token estimate: ~900 -->

# Frontend

Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui + AI Elements. The live chat surface is **`/play/[slug]`** (Wave 6). The original starter `/chat` page survives but talks to a stale `/api/chat` route and is no longer the entry point.

## Page tree

```
src/app/
├── layout.tsx           Root layout — fonts (Geist, Figtree), <html> + <body>
├── globals.css          Tailwind v4 entry
├── page.tsx             Home — create-next-app scaffold (placeholder)
├── chat/page.tsx        'use client' — stale starter chat, points at /api/chat
└── play/[slug]/
    ├── page.tsx              Server component; awaits params, renders <PlayClient>
    ├── play-client.tsx       Main client (~242 LOC) — owns SSE state + UI
    ├── phase-tape.tsx        Right rail — Task list with per-phase status icons
    ├── mutex-banner.tsx      Alert shown when 'still working' fires
    └── turn-images.tsx       Illustrator image grid, sourced from /api/turn/image
```

## Play page flow (`src/app/play/[slug]/play-client.tsx`)

```
PlayClient({ slug })
  useReducer(reduceTurns)         turns: TurnRecord[]  (per-turn UiState)
  useState(busy, mutexMessage)

  submit(text):
    POST /api/turn { slug, input: text }
    res.body.getReader() loop:
      buf += decode(value)
      { events, rest } = parseSseChunks(buf)        → src/lib/sse/parse.ts
      buf = rest
      for ev of events:
        dispatch({ type:'event', id, ev })          → reducePhaseEvent
        if ev.type==='error' && ev.message==='still working'
          → setMutexMessage(...)                    → MutexBanner

  Layout (lg:flex-row):
    ├── left  (flex-1)
    │     <h1>{slug}</h1>
    │     <MutexBanner>
    │     <Conversation>                            ai-elements
    │       turns.map → <TurnView slug turn>
    │     <PromptInput>                             disabled while busy
    │
    └── aside (lg:w-80)
          <PhaseTape phases={latestTurn.state.phases}>
```

### `<TurnView>`

```
<Message from="user">                  the player's submitted text
<Message from="assistant">             streaming MessageResponse: prose ?? finalProse
  └─ Error variant if state.error
<AudioPlayer>                          when status==='done' && audioPath
   ├ <AudioPlayerElement src=/api/turn/audio?slug=…&filename=basename(audioPath)/>
   └ AudioPlayer control bar (play / time / mute / volume)
<TurnImages slug images>               when status==='done' && images.length>0
   └ <img src=/api/turn/image?slug=…&filename=… /> per image
```

### State machine per turn

`UiState` from `src/lib/sse/reducer.ts`:

```
status      'idle' → 'streaming' → 'done' | 'error'
phases[]    PhaseRecord[]   (factions | narrator | media | persist; status: pending|active|done)
prose       running concatenation of prose_delta.text  (cleared once finalProse arrives)
finalProse  string | null   (illustrator's prose_with_embeds; replaces prose at 'done')
audioPath   string | null
images      ImageMeta[]
error       { message, recoverable } | null
```

`reducePhaseEvent` is a pure function — node-testable without jsdom.

## Component library

| Folder                        | Source                                                                           | Count |
| ----------------------------- | -------------------------------------------------------------------------------- | ----- |
| `src/components/ui/`          | shadcn primitives (button, card, dialog, alert, spinner, …)                      | ~25   |
| `src/components/ai-elements/` | AI Elements widgets (conversation, message, prompt-input, audio-player, task, …) | ~60   |

The play page uses: `Conversation`, `Message` (+ `MessageContent`, `MessageResponse`), `PromptInput` (+ body/footer/textarea/submit), `AudioPlayer` (+ controls), `Task` (+ items/triggers). Everything else in `ai-elements/` is pre-installed but unused.

## Phase tape (`phase-tape.tsx`)

Renders `state.phases` as a `<Task>` list with three states:

| Status    | Icon                       |
| --------- | -------------------------- |
| `done`    | `CheckIcon` (emerald-500)  |
| `active`  | `Spinner`                  |
| `pending` | `CircleDashedIcon` (muted) |

The factions phase shows `Factions (N)` from `phase.count`.

## Asset proxying

Vault images and audio live outside `public/` (`vaults/<slug>/images/`, `vaults/<slug>/audio/`). They're served on demand through `/api/turn/{image,audio}?slug=…&filename=…`, which path-checks the request and streams the bytes. The `next/image` loader is not used (would 404), so a plain `<img>` with an eslint-disable comment is used in `turn-images.tsx`.

## Styling

- Tailwind v4 (`@tailwindcss/postcss`)
- `tw-animate-css` for keyframes
- `class-variance-authority` + `clsx` + `tailwind-merge` via `src/lib/utils.ts` (`cn()`)
- Three fonts: Geist Sans, Geist Mono, Figtree (CSS variables `--font-*`)

## Conventions

- Imports use `@/` path alias (`tsconfig.json` baseUrl)
- All client components declare `'use client'` at top
- Tailwind dark-mode via `dark:` variants (no theme provider yet)
- Per-turn `id = turn-${Date.now()}` is a stable React key; **not** the workflow's `turnId` (which is `turn-NNN` minted on the server)

## Not yet implemented

- Auth, multi-thread switcher, vault selector (no `/play` index page yet — slug is typed by URL)
- Journal viewer / playtest viewer
- NPC sheet, faction trigger badges, world-tick toasts (`matured` threads not surfaced)
- Tool-call rendering (dice/loadEntity calls aren't shown to the player)
- Replacement / deletion of `/chat` + `/api/chat` starter scaffold
