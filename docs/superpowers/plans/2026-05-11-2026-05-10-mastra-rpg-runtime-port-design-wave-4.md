# Wave 4 — Tools, Agents, Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Mastra surface: three tools (`dice`, `loadEntity`, `image`), three agents (`narrator`, `faction`, `illustrator`), and updated registration in `src/mastra/index.ts`, so all three RPG agents are callable from Mastra Studio with hand-built dossiers. Removes the leftover `weather-agent` / `weather-workflow` / `weather-tool` scaffolding.

**Architecture:** Tools live under `src/mastra/tools/` and are thin adapters: `image.ts` wraps `src/lib/media/image.ts` (Wave 3), `loadEntity.ts` wraps `src/lib/vault/entities.ts` loaders (Wave 1) with a `{ found: false }` shape for missing slugs, and `dice.ts` is a pure parser+roller for `2d6+1` / `pbta+2` / `advantage` / `disadvantage` (the only file with new domain logic this wave). Agents live under `src/mastra/agents/`, each ~80 LOC: a system-prompt constant, model `openai/gpt-5.5`, `providerOptions.openai.reasoningEffort: 'high'`, structured output via `defaultOptions.structuredOutput.schema` pointing at the Zod schemas from Wave 3's `src/lib/schemas.ts` (`FactionOutput`, `NarratorOutput`, `IllustratorOutput`), and the tool wiring per spec (narrator: `{ loadEntity, dice }`; illustrator: `{ image }`; faction: no tools in v0). Registration updates `src/mastra/index.ts` to register `{ narratorAgent, factionAgent, illustratorAgent }` and drop `weatherAgent` + `weatherWorkflow`. The orphaned files (`agents/weather-agent.ts`, `tools/weather-tool.ts`, `workflows/weather-workflow.ts`) get deleted as part of the same task — the spec's "Out-of-band cleanup" section makes this a Wave-4-or-later chore, and Wave 4 is the natural home for it.

**Tech Stack:** TypeScript (ES2022 strict), Mastra `@mastra/core/agent` `Agent`, `@mastra/core/tools` `createTool`, Zod 4 (already present), Node 22.13+ `node:crypto` for dice RNG, vitest for unit tests. No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-05-10-mastra-rpg-runtime-port-design.md` — Wave 4 section (lines 547–566), Component layout (lines 94–98), Per-turn workflow tool callouts (lines 230 narrator tools, 249 illustrator tools), Error-matrix rows for `loadEntity` missing slug (line 343) and `dice` invalid expression (line 344), Models row "`openai/gpt-5.5`, `reasoningEffort: 'high'`" (line 319), and Out-of-band cleanup (lines 601–605).

**Wave-1/2/3 outputs you depend on (already merged, do NOT modify):**

- `src/lib/schemas.ts` — exports `FactionOutput`, `NarratorOutput`, `IllustratorOutput`, `ImageMeta` (all `z.object`s with inferred TS types re-exported). Agents reference these directly via `defaultOptions.structuredOutput.schema`.
- `src/lib/media/image.ts` — exports `generateImage({ prompt, slug, vaultRoot, apiKey?, size?, quality?, deps? })` returning `ImageMeta`. The `image` tool calls this.
- `src/lib/vault/entities.ts` — exports `loadNpc(root, slug)`, `loadFaction(root, slug)`, `loadLocation(root, slug)`, plus `EntityDoc = { slug, frontmatter, body }`. The `loadEntity` tool dispatches on `kind`.
- `src/lib/vault/paths.ts` — exports `vaultRoot(slug)`. The `image` and `loadEntity` tools resolve the vault root from `process.env.VAULT_SLUG` via this helper.
- `src/lib/vault/frontmatter.ts` — exports `Frontmatter`. Re-exported from `entities` indirectly; tools surface frontmatter as a plain object.

**Confirmed Mastra SDK shape (verified against `node_modules/@mastra/core@1.32.1`):**

- `Agent` constructor accepts `{ id, name, instructions, model, tools, defaultOptions, memory?, description? }`. Tools is a `Record<string, Tool>`.
- `instructions` may be a string, or an object `{ role: 'system', content: string, providerOptions?: { openai: { reasoningEffort: 'minimal'|'low'|'medium'|'high' } } }`. The existing `weather-agent` uses the object form — we follow the same pattern.
- Structured output is configured per-call via `options.structuredOutput.schema`, OR globally via `defaultOptions.structuredOutput.schema`. Wave 4 uses `defaultOptions` so calling `agent.generate(dossier)` in Wave 5 returns `result.object` typed to the schema without re-passing it.
- `createTool({ id, description, inputSchema, outputSchema, execute })` returns a `Tool`. `execute` receives the validated input object as its first arg and an optional context as its second; we ignore the context in Wave 4.
- Model strings use `'provider/model-name'`. `openai/gpt-5.5` is in the provider registry (verified via `node scripts/provider-registry.mjs --provider openai`).

---

## Pre-flight check (informational — do NOT re-run if green)

Before starting, verify Waves 1-3 are in fact in place. If anything below is missing or has drifted, **stop and report** rather than fix inline — those are separate tickets.

- [ ] **Verify Wave-1/2/3 source files exist.**

```bash
ls src/lib/schemas.ts src/lib/dossier.ts src/lib/media/image.ts src/lib/media/tts.ts \
   src/lib/vault/paths.ts src/lib/vault/entities.ts src/lib/vault/frontmatter.ts
```

Expected: all seven paths listed. If any missing, abort.

- [ ] **Verify all existing tests pass on a clean tree.**

```bash
pnpm test --run
```

Expected: green. If anything fails, abort — Wave 4 must build on a green baseline.

- [ ] **Verify the Mastra package is at a Wave-4-compatible version.**

```bash
node -e "console.log(require('./node_modules/@mastra/core/package.json').version)"
```

Expected: `1.32.x` or newer. If older, abort and report — the `defaultOptions.structuredOutput` API depends on it.

- [ ] **Verify the working tree is clean on the wave-4 branch.**

```bash
git status -uno && git rev-parse --abbrev-ref HEAD
```

Expected: clean tree, branch `auto/2026-05-10-mastra-rpg-runtime-port-design-wave-4`.

---

## File structure

Production files (all new except `index.ts`):

| File                               | Responsibility                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mastra/tools/dice.ts`         | Pure dice parser+roller. Inputs `expression: string`, returns `{ expression, total, rolls, breakdown }` or throws (Mastra wraps the throw as a tool error). Handles `NdM[+K]`, `pbta[+K]` (= `2d6+K`), `advantage`/`disadvantage`.                                  |
| `src/mastra/tools/loadEntity.ts`   | Wraps `loadNpc` / `loadFaction` / `loadLocation` from `src/lib/vault/entities.ts`. Resolves vault root from `process.env.VAULT_SLUG`. Returns `{ found: true, slug, frontmatter, body }` or `{ found: false, slug, kind, error }` — never throws on a missing file. |
| `src/mastra/tools/image.ts`        | Wraps `generateImage` from `src/lib/media/image.ts`. Resolves vault root from `process.env.VAULT_SLUG`. Returns the `ImageMeta` record verbatim.                                                                                                                    |
| `src/mastra/agents/narrator.ts`    | `openai/gpt-5.5` agent. Structured output `NarratorOutput`. Tools: `{ loadEntity, dice }`. System prompt describes role, schema, and tool use.                                                                                                                      |
| `src/mastra/agents/faction.ts`     | `openai/gpt-5.5` agent. Structured output `FactionOutput`. No tools. System prompt describes faction-agent role.                                                                                                                                                    |
| `src/mastra/agents/illustrator.ts` | `openai/gpt-5.5` agent. Structured output `IllustratorOutput`. Tools: `{ image }`. System prompt describes illustrator role + `![[file.png]]` embeds.                                                                                                               |
| `src/mastra/index.ts`              | Register `{ narratorAgent, factionAgent, illustratorAgent }`. Drop `weatherAgent` and `weatherWorkflow`. Storage / logger / observability unchanged.                                                                                                                |

Deleted files (cleanup chore baked into Task 7):

- `src/mastra/agents/weather-agent.ts`
- `src/mastra/tools/weather-tool.ts`
- `src/mastra/workflows/weather-workflow.ts`

Test files (all new):

| File                                    | Coverage                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/mastra/tools/dice.test.ts`         | `2d6`, `2d6+1`, `pbta`, `pbta+2`, `advantage`, `disadvantage`, invalid expressions throw. |
| `src/mastra/tools/loadEntity.test.ts`   | Loads a fixture NPC; returns `{ found: false }` for missing slug; rejects unknown kind.   |
| `src/mastra/tools/image.test.ts`        | Calls the injected `generateImage` with the right args; returns its `ImageMeta` verbatim. |
| `src/mastra/agents/narrator.test.ts`    | Construction sanity: id, model, tool keys, has `defaultOptions.structuredOutput.schema`.  |
| `src/mastra/agents/faction.test.ts`     | Construction sanity: id, model, no tools, schema wired.                                   |
| `src/mastra/agents/illustrator.test.ts` | Construction sanity: id, model, has `image` tool, schema wired.                           |

Note on agent tests: Wave 4 does not exercise live LLM calls. The construction tests assert the agent objects have the right shape so registration is verifiable in CI without spending tokens. Live agent smoke testing happens in Wave 5's integration tests and the live smoke script. The Wave-4 exit criterion "All three agents callable from Mastra Studio" is an interactive manual check, not an automated test.

---

## Task 1: `dice` tool

**Files:**

- Create: `src/mastra/tools/dice.ts`
- Test: `src/mastra/tools/dice.test.ts`

The dice tool is the only Wave-4 file with new domain logic. It's a pure parser+roller; we own the entire surface, so unit tests are cheap and exhaustive.

**Grammar supported:**

- `NdM` where `N` and `M` are positive integers (e.g. `2d6`, `3d8`). Returns sum of N rolls of an M-sided die.
- `NdM+K` or `NdM-K` where `K` is a non-negative integer modifier (e.g. `2d6+1`, `1d20-3`).
- `pbta` (alias for `2d6`) and `pbta+K` / `pbta-K` (alias for `2d6+K` / `2d6-K`).
- `advantage` (alias for "roll 2d20, take the higher") and `disadvantage` (= "roll 2d20, take the lower"). No modifier suffix.
- Anything else: throw `Error('dice: invalid expression: ...')`. Mastra propagates the throw to the agent as a tool error; the agent retries per the spec error matrix.

**Output shape (Zod):**

```ts
z.object({
  expression: z.string(), // echoed back, lowercased + trimmed
  total: z.number().int(), // final result after modifier
  rolls: z.array(z.number().int()), // individual die faces
  breakdown: z.string(), // human-readable, e.g. "2d6+1: [3, 5] + 1 = 9"
});
```

- [ ] **Step 1: Write failing tests for `rollDice` and the tool.**

Create `src/mastra/tools/dice.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { rollDice, diceTool } from './dice';

describe('rollDice', () => {
  it('parses and rolls 2d6 with a fixed RNG', () => {
    const rng = vi.fn().mockReturnValueOnce(0.0).mockReturnValueOnce(0.99); // 1, then 6
    const r = rollDice('2d6', rng);
    expect(r.expression).toBe('2d6');
    expect(r.rolls).toEqual([1, 6]);
    expect(r.total).toBe(7);
    expect(r.breakdown).toBe('2d6: [1, 6] = 7');
  });

  it('applies a positive modifier (2d6+1)', () => {
    const rng = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.5); // 4, 4
    const r = rollDice('2d6+1', rng);
    expect(r.rolls).toEqual([4, 4]);
    expect(r.total).toBe(9);
    expect(r.breakdown).toBe('2d6+1: [4, 4] + 1 = 9');
  });

  it('applies a negative modifier (1d20-3)', () => {
    const rng = vi.fn().mockReturnValueOnce(0.95); // 20
    const r = rollDice('1d20-3', rng);
    expect(r.rolls).toEqual([20]);
    expect(r.total).toBe(17);
    expect(r.breakdown).toBe('1d20-3: [20] - 3 = 17');
  });

  it('aliases pbta to 2d6', () => {
    const rng = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.99); // 4, 6
    const r = rollDice('pbta+2', rng);
    expect(r.rolls).toEqual([4, 6]);
    expect(r.total).toBe(12);
    expect(r.breakdown).toBe('pbta+2: [4, 6] + 2 = 12');
  });

  it('advantage rolls 2d20 and keeps the higher', () => {
    const rng = vi.fn().mockReturnValueOnce(0.05).mockReturnValueOnce(0.85); // 2, 18
    const r = rollDice('advantage', rng);
    expect(r.rolls).toEqual([2, 18]);
    expect(r.total).toBe(18);
    expect(r.breakdown).toBe('advantage: [2, 18] keep higher = 18');
  });

  it('disadvantage rolls 2d20 and keeps the lower', () => {
    const rng = vi.fn().mockReturnValueOnce(0.05).mockReturnValueOnce(0.85); // 2, 18
    const r = rollDice('disadvantage', rng);
    expect(r.rolls).toEqual([2, 18]);
    expect(r.total).toBe(2);
    expect(r.breakdown).toBe('disadvantage: [2, 18] keep lower = 2');
  });

  it('is case-insensitive and trims whitespace', () => {
    const rng = vi.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.5);
    const r = rollDice('  2D6  ', rng);
    expect(r.expression).toBe('2d6');
    expect(r.total).toBe(8);
  });

  it('throws on garbage input', () => {
    expect(() => rollDice('foo', () => 0.5)).toThrow(/invalid expression/);
  });

  it('throws on zero dice', () => {
    expect(() => rollDice('0d6', () => 0.5)).toThrow(/invalid expression/);
  });

  it('throws on zero-sided die', () => {
    expect(() => rollDice('2d0', () => 0.5)).toThrow(/invalid expression/);
  });
});

describe('diceTool', () => {
  it('exposes id "dice" and an input schema with `expression`', () => {
    expect(diceTool.id).toBe('dice');
    expect(diceTool.inputSchema).toBeDefined();
  });

  it('execute() returns a rolled result for a valid expression', async () => {
    // The tool uses Math.random by default; here we just check the shape.
    const out = await diceTool.execute!({ context: { expression: '2d6' } } as any);
    expect(out.expression).toBe('2d6');
    expect(out.rolls).toHaveLength(2);
    expect(out.rolls.every((n: number) => n >= 1 && n <= 6)).toBe(true);
    expect(out.total).toBe(out.rolls.reduce((s: number, n: number) => s + n, 0));
  });

  it('execute() throws on an invalid expression so Mastra surfaces a tool error', async () => {
    await expect(diceTool.execute!({ context: { expression: 'banana' } } as any)).rejects.toThrow(
      /invalid expression/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/tools/dice.test.ts --run
```

Expected: FAIL with "Cannot find module './dice'".

- [ ] **Step 3: Implement `src/mastra/tools/dice.ts`.**

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Pure dice parser + roller. The narrator's `dice` tool is the only Wave-4
 * file with new domain logic; `rollDice` is exported separately so the
 * randomness can be pinned in tests by injecting a deterministic `rng`.
 *
 * Grammar:
 *   NdM            — N positive int, M positive int (e.g. 2d6, 1d20)
 *   NdM+K | NdM-K  — K non-negative int modifier
 *   pbta[+K|-K]    — alias for 2d6[+K|-K]
 *   advantage      — 2d20, keep higher (no modifier suffix)
 *   disadvantage   — 2d20, keep lower (no modifier suffix)
 *
 * Anything else throws `Error('dice: invalid expression: <raw>')`. Mastra
 * propagates this throw to the calling agent as a tool error; per the spec
 * error matrix the agent retries with a valid expression.
 */
export interface DiceResult {
  expression: string;
  total: number;
  rolls: number[];
  breakdown: string;
}

const NDM_RE = /^(\d+)d(\d+)([+-]\d+)?$/;
const PBTA_RE = /^pbta([+-]\d+)?$/;

export function rollDice(rawExpression: string, rng: () => number = Math.random): DiceResult {
  const expression = rawExpression.trim().toLowerCase();
  if (expression === 'advantage' || expression === 'disadvantage') {
    const a = roll(20, rng);
    const b = roll(20, rng);
    const keep = expression === 'advantage' ? Math.max(a, b) : Math.min(a, b);
    const which = expression === 'advantage' ? 'higher' : 'lower';
    return {
      expression,
      total: keep,
      rolls: [a, b],
      breakdown: `${expression}: [${a}, ${b}] keep ${which} = ${keep}`,
    };
  }

  const pbtaMatch = expression.match(PBTA_RE);
  if (pbtaMatch) {
    const mod = pbtaMatch[1] ? parseInt(pbtaMatch[1], 10) : 0;
    return rollNdMWithMod(expression, 2, 6, mod, rng);
  }

  const ndmMatch = expression.match(NDM_RE);
  if (ndmMatch) {
    const n = parseInt(ndmMatch[1], 10);
    const m = parseInt(ndmMatch[2], 10);
    const mod = ndmMatch[3] ? parseInt(ndmMatch[3], 10) : 0;
    if (n <= 0 || m <= 0) {
      throw new Error(`dice: invalid expression: ${rawExpression}`);
    }
    return rollNdMWithMod(expression, n, m, mod, rng);
  }

  throw new Error(`dice: invalid expression: ${rawExpression}`);
}

function rollNdMWithMod(
  expression: string,
  n: number,
  m: number,
  mod: number,
  rng: () => number,
): DiceResult {
  const rolls: number[] = [];
  for (let i = 0; i < n; i++) rolls.push(roll(m, rng));
  const sum = rolls.reduce((s, r) => s + r, 0);
  const total = sum + mod;
  const list = `[${rolls.join(', ')}]`;
  const modText = mod === 0 ? '' : ` ${mod > 0 ? '+' : '-'} ${Math.abs(mod)}`;
  return {
    expression,
    total,
    rolls,
    breakdown: `${expression}: ${list}${modText} = ${total}`,
  };
}

function roll(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1;
}

const outputSchema = z.object({
  expression: z.string(),
  total: z.number().int(),
  rolls: z.array(z.number().int()),
  breakdown: z.string(),
});

export const diceTool = createTool({
  id: 'dice',
  description:
    'Roll dice. Supports NdM, NdM+K, NdM-K, pbta, pbta+K, pbta-K, advantage, disadvantage. ' +
    'Returns the rolls and the total. Throws on invalid expressions; retry with a valid one.',
  inputSchema: z.object({
    expression: z.string().min(1).describe('e.g. "2d6+1", "pbta+2", "advantage", "1d20"'),
  }),
  outputSchema,
  execute: async ({ context }) => {
    return rollDice(context.expression);
  },
});
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest src/mastra/tools/dice.test.ts --run
```

Expected: all dice tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/tools/dice.ts src/mastra/tools/dice.test.ts
git commit -m "feat(tools): dice tool with NdM, pbta, advantage/disadvantage grammar"
```

---

## Task 2: `loadEntity` tool

**Files:**

- Create: `src/mastra/tools/loadEntity.ts`
- Test: `src/mastra/tools/loadEntity.test.ts`

Wraps the Wave-1 entity loaders (`loadNpc`, `loadFaction`, `loadLocation`) and converts a missing-file error into the spec-mandated `{ found: false }` shape so agents handle it gracefully.

**Vault root resolution.** The spec ships v0 with `VAULT_SLUG=commodore-vex` in `.env.local`. The tool reads `process.env.VAULT_SLUG` and resolves the root via `vaultRoot(slug)`. If `VAULT_SLUG` is unset, throw — that's an environment-misconfiguration error, not a found/not-found question. For tests, the resolver is overridable via an optional `deps.vaultRoot` (default reads env).

**Output shape (Zod):**

```ts
z.discriminatedUnion('found', [
  z.object({
    found: z.literal(true),
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    body: z.string(),
  }),
  z.object({
    found: z.literal(false),
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string(),
    error: z.string(),
  }),
]);
```

- [ ] **Step 1: Write failing tests.**

Create `src/mastra/tools/loadEntity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { loadEntityTool, loadEntityImpl } from './loadEntity';

const FIXTURE_ROOT = path.resolve(__dirname, '../../../tests/fixtures/test-vault');

describe('loadEntityImpl', () => {
  it('loads an existing NPC and returns frontmatter + body', async () => {
    const res = await loadEntityImpl({ kind: 'npc', slug: 'kessha' }, { vaultRoot: FIXTURE_ROOT });
    expect(res.found).toBe(true);
    if (!res.found) throw new Error('unreachable');
    expect(res.slug).toBe('kessha');
    expect(res.kind).toBe('npc');
    expect(typeof res.body).toBe('string');
    expect(res.body.length).toBeGreaterThan(0);
    // Kessha has faction: red-banner per the fixture.
    expect(res.frontmatter.faction).toBe('red-banner');
  });

  it('loads an existing faction', async () => {
    const res = await loadEntityImpl(
      { kind: 'faction', slug: 'red-banner' },
      { vaultRoot: FIXTURE_ROOT },
    );
    expect(res.found).toBe(true);
  });

  it('loads an existing location', async () => {
    const res = await loadEntityImpl(
      { kind: 'location', slug: 'iron-promise' },
      { vaultRoot: FIXTURE_ROOT },
    );
    expect(res.found).toBe(true);
  });

  it('returns { found: false } for a missing slug', async () => {
    const res = await loadEntityImpl(
      { kind: 'npc', slug: 'does-not-exist' },
      { vaultRoot: FIXTURE_ROOT },
    );
    expect(res.found).toBe(false);
    if (res.found) throw new Error('unreachable');
    expect(res.kind).toBe('npc');
    expect(res.slug).toBe('does-not-exist');
    expect(res.error).toMatch(/ENOENT|no such file/i);
  });
});

describe('loadEntityTool', () => {
  it('exposes id "loadEntity" with the documented input schema', () => {
    expect(loadEntityTool.id).toBe('loadEntity');
    expect(loadEntityTool.inputSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/tools/loadEntity.test.ts --run
```

Expected: FAIL with "Cannot find module './loadEntity'".

- [ ] **Step 3: Implement `src/mastra/tools/loadEntity.ts`.**

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { loadNpc, loadFaction, loadLocation } from '@/lib/vault/entities';
import { vaultRoot } from '@/lib/vault/paths';

/**
 * Read-only entity loader. Wraps the Wave-1 loaders; the file-missing case
 * returns `{ found: false }` instead of throwing so the agent can decide
 * whether to use a stub or skip (spec error matrix line 343).
 *
 * Vault root resolution: defaults to `vaultRoot(process.env.VAULT_SLUG)`.
 * Tests override via `deps.vaultRoot`.
 */
export type EntityKind = 'npc' | 'faction' | 'location';

export interface LoadEntityInput {
  kind: EntityKind;
  slug: string;
}

export interface LoadEntityDeps {
  vaultRoot?: string;
}

export type LoadEntityResult =
  | {
      found: true;
      kind: EntityKind;
      slug: string;
      frontmatter: Record<string, unknown>;
      body: string;
    }
  | { found: false; kind: EntityKind; slug: string; error: string };

function resolveRoot(deps?: LoadEntityDeps): string {
  if (deps?.vaultRoot) return deps.vaultRoot;
  const slug = process.env.VAULT_SLUG;
  if (!slug) {
    throw new Error('loadEntity: VAULT_SLUG env var is unset (and no deps.vaultRoot provided)');
  }
  return vaultRoot(slug);
}

export async function loadEntityImpl(
  input: LoadEntityInput,
  deps?: LoadEntityDeps,
): Promise<LoadEntityResult> {
  const root = resolveRoot(deps);
  try {
    const doc =
      input.kind === 'npc'
        ? await loadNpc(root, input.slug)
        : input.kind === 'faction'
          ? await loadFaction(root, input.slug)
          : await loadLocation(root, input.slug);
    return {
      found: true,
      kind: input.kind,
      slug: doc.slug,
      frontmatter: doc.frontmatter as Record<string, unknown>,
      body: doc.body,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { found: false, kind: input.kind, slug: input.slug, error: msg };
  }
}

const outputSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(true),
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    body: z.string(),
  }),
  z.object({
    found: z.literal(false),
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string(),
    error: z.string(),
  }),
]);

export const loadEntityTool = createTool({
  id: 'loadEntity',
  description:
    'Read a vault entity by kind + slug. Returns { found: true, kind, slug, frontmatter, body } ' +
    'on hit, or { found: false, kind, slug, error } on miss. Use when you need detail on ' +
    'a wikilink target that is not in the on-stage block.',
  inputSchema: z.object({
    kind: z.enum(['npc', 'faction', 'location']),
    slug: z.string().min(1),
  }),
  outputSchema,
  execute: async ({ context }) => loadEntityImpl(context),
});
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest src/mastra/tools/loadEntity.test.ts --run
```

Expected: all loadEntity tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/tools/loadEntity.ts src/mastra/tools/loadEntity.test.ts
git commit -m "feat(tools): loadEntity reads npc/faction/location with { found: false } on miss"
```

---

## Task 3: `image` tool

**Files:**

- Create: `src/mastra/tools/image.ts`
- Test: `src/mastra/tools/image.test.ts`

Thin adapter over `generateImage` from `src/lib/media/image.ts`. The illustrator agent calls this 0-3 times per turn to produce scene PNGs.

**Vault root resolution.** Same pattern as `loadEntity`: read `process.env.VAULT_SLUG`, resolve via `vaultRoot(slug)`. Override via `deps.vaultRoot` in tests.

**Output shape.** Mirrors `ImageMeta` from `src/lib/schemas.ts` (`filename`, `path`, `prompt`, `slug`). The illustrator agent's structured output requires it, so the tool returns the exact shape.

- [ ] **Step 1: Write failing test.**

Create `src/mastra/tools/image.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { imageTool, imageImpl } from './image';

async function tmpVault(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rpg-image-tool-'));
}

describe('imageImpl', () => {
  it('delegates to generateImage with prompt + slug + resolved vaultRoot and returns ImageMeta', async () => {
    const vaultRoot = await tmpVault();
    const fakeMeta = {
      filename: '20260511-140000-kessha-abc123.png',
      path: path.join(vaultRoot, 'images', '20260511-140000-kessha-abc123.png'),
      prompt: 'Kessha at the helm',
      slug: 'kessha',
    };
    const generate = vi.fn().mockResolvedValue(fakeMeta);
    const res = await imageImpl(
      { prompt: 'Kessha at the helm', slug: 'kessha' },
      { vaultRoot, generateImage: generate },
    );
    expect(res).toEqual(fakeMeta);
    expect(generate).toHaveBeenCalledTimes(1);
    const args = generate.mock.calls[0][0];
    expect(args.prompt).toBe('Kessha at the helm');
    expect(args.slug).toBe('kessha');
    expect(args.vaultRoot).toBe(vaultRoot);
  });

  it('throws if VAULT_SLUG is unset and no deps.vaultRoot is provided', async () => {
    const generate = vi.fn();
    const prev = process.env.VAULT_SLUG;
    delete process.env.VAULT_SLUG;
    try {
      await expect(
        imageImpl({ prompt: 'p', slug: 's' }, { generateImage: generate }),
      ).rejects.toThrow(/VAULT_SLUG/);
    } finally {
      if (prev !== undefined) process.env.VAULT_SLUG = prev;
    }
  });
});

describe('imageTool', () => {
  it('exposes id "image" with prompt + slug inputs', () => {
    expect(imageTool.id).toBe('image');
    expect(imageTool.inputSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/tools/image.test.ts --run
```

Expected: FAIL with "Cannot find module './image'".

- [ ] **Step 3: Implement `src/mastra/tools/image.ts`.**

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateImage } from '@/lib/media/image';
import { vaultRoot } from '@/lib/vault/paths';
import { ImageMeta } from '@/lib/schemas';

/**
 * Thin adapter over `src/lib/media/image.ts`. The illustrator calls this
 * 0-3 times per turn; the workflow runs them in the illustrator's tool loop.
 *
 * Vault root: defaults to `vaultRoot(process.env.VAULT_SLUG)`. Tests
 * override via `deps.vaultRoot`; `deps.generateImage` is the SDK seam.
 */
export interface ImageInput {
  prompt: string;
  slug: string;
}

export interface ImageDeps {
  vaultRoot?: string;
  generateImage?: typeof generateImage;
}

function resolveRoot(deps?: ImageDeps): string {
  if (deps?.vaultRoot) return deps.vaultRoot;
  const slug = process.env.VAULT_SLUG;
  if (!slug) {
    throw new Error('image: VAULT_SLUG env var is unset (and no deps.vaultRoot provided)');
  }
  return vaultRoot(slug);
}

export async function imageImpl(input: ImageInput, deps?: ImageDeps): Promise<ImageMeta> {
  const root = resolveRoot(deps);
  const gen = deps?.generateImage ?? generateImage;
  return gen({ prompt: input.prompt, slug: input.slug, vaultRoot: root });
}

export const imageTool = createTool({
  id: 'image',
  description:
    'Generate an image (gpt-image-2, quality=high) and write it under <vault>/images/. ' +
    'Returns { filename, path, prompt, slug }. The illustrator uses `filename` to embed the image in prose as `![[filename.png]]`.',
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .describe(
        'The image prompt. The vault style-guide ## Visual block is prepended upstream by the illustrator before calling this tool.',
      ),
    slug: z
      .string()
      .min(1)
      .describe('A short kebab-case slug used in the filename (e.g. "kessha-helm").'),
  }),
  outputSchema: ImageMeta,
  execute: async ({ context }) => imageImpl(context),
});
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest src/mastra/tools/image.test.ts --run
```

Expected: all image-tool tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/tools/image.ts src/mastra/tools/image.test.ts
git commit -m "feat(tools): image tool delegates to lib/media/image (gpt-image-2)"
```

---

## Task 4: `faction` agent

**Files:**

- Create: `src/mastra/agents/faction.ts`
- Test: `src/mastra/agents/faction.test.ts`

The faction agent gets a per-faction dossier and returns `{ decision, reasoning }`. No tools in v0 — the dossier is self-contained. Model `openai/gpt-5.5`, `reasoningEffort: 'high'`.

- [ ] **Step 1: Write failing construction test.**

Create `src/mastra/agents/faction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { factionAgent } from './faction';
import { FactionOutput } from '@/lib/schemas';

describe('factionAgent', () => {
  it('has id "faction" and model "openai/gpt-5.5"', () => {
    expect(factionAgent.id).toBe('faction');
    // Mastra normalises the model string onto the agent under .modelId or .model;
    // we read whichever surface the SDK exposes via a generic getter.
    const model: unknown =
      (factionAgent as unknown as { model?: unknown }).model ??
      (factionAgent as unknown as { modelId?: unknown }).modelId;
    expect(model).toBe('openai/gpt-5.5');
  });

  it('has no tools in v0', async () => {
    const tools = await factionAgent.getTools?.({ requestContext: {} as any });
    expect(tools === undefined || Object.keys(tools).length === 0).toBe(true);
  });

  it('wires FactionOutput as its default structured output schema', () => {
    const defaults = (
      factionAgent as unknown as {
        defaultOptions?: { structuredOutput?: { schema?: unknown } };
      }
    ).defaultOptions;
    expect(defaults?.structuredOutput?.schema).toBe(FactionOutput);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/agents/faction.test.ts --run
```

Expected: FAIL with "Cannot find module './faction'".

- [ ] **Step 3: Implement `src/mastra/agents/faction.ts`.**

```ts
import { Agent } from '@mastra/core/agent';
import { FactionOutput } from '@/lib/schemas';

const SYSTEM_PROMPT = `You play one faction in an ongoing tabletop RPG. The Game Master will send you a dossier describing:
- the world's current state and the player character's situation,
- your faction's body text (goals, agents, current operations),
- the on-stage NPCs (your members and others),
- the recent journal (what just happened),
- the player's latest action.

Decide what your faction does this turn in response to the player's action. Stay in character. Your decision is what the faction does as a group — it may be coordinated by leaders, surface through individual NPCs on stage, or simply be an instruction that propagates through your channels. The narrator will use your decision (not your reasoning) to shape the prose.

Return a JSON object with exactly two fields:
- decision: one to three sentences describing what your faction does. Plain prose. No wikilinks, no markdown formatting.
- reasoning: a short rationale (one to three sentences) explaining why your faction chose this. This is read by the GM only — players never see it. Be specific about which faction goals/values drove the call.

If the player did nothing your faction cares about, your decision can be "[no response]" with reasoning that explains why this turn is below your radar.`;

export const factionAgent = new Agent({
  id: 'faction',
  name: 'Faction Agent',
  description:
    'Plays one faction per call. Returns { decision, reasoning } given a per-faction dossier.',
  instructions: {
    role: 'system',
    content: SYSTEM_PROMPT,
    providerOptions: {
      openai: { reasoningEffort: 'high' },
    },
  },
  model: 'openai/gpt-5.5',
  defaultOptions: {
    structuredOutput: {
      schema: FactionOutput,
    },
  },
});
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest src/mastra/agents/faction.test.ts --run
```

Expected: all faction-agent tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/agents/faction.ts src/mastra/agents/faction.test.ts
git commit -m "feat(agents): faction agent with FactionOutput and reasoningEffort: high"
```

---

## Task 5: `narrator` agent

**Files:**

- Create: `src/mastra/agents/narrator.ts`
- Test: `src/mastra/agents/narrator.test.ts`

The narrator gets a dossier with world + character + threads + style guide + on-stage + recent journal + faction decisions + player input + turn id, returns `{ prose, time_passed? }`, and may call `loadEntity` (lookup detail on an off-stage wikilink target) or `dice` (live rolls mid-prose) during generation. Tools are imported from the two prior tasks.

- [ ] **Step 1: Write failing test.**

Create `src/mastra/agents/narrator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { narratorAgent } from './narrator';
import { NarratorOutput } from '@/lib/schemas';

describe('narratorAgent', () => {
  it('has id "narrator" and model "openai/gpt-5.5"', () => {
    expect(narratorAgent.id).toBe('narrator');
    const model: unknown =
      (narratorAgent as unknown as { model?: unknown }).model ??
      (narratorAgent as unknown as { modelId?: unknown }).modelId;
    expect(model).toBe('openai/gpt-5.5');
  });

  it('wires loadEntity and dice as tools', async () => {
    const tools = await narratorAgent.getTools?.({ requestContext: {} as any });
    expect(tools).toBeDefined();
    const keys = Object.keys(tools as Record<string, unknown>);
    expect(keys.sort()).toEqual(['dice', 'loadEntity']);
  });

  it('wires NarratorOutput as its default structured output schema', () => {
    const defaults = (
      narratorAgent as unknown as {
        defaultOptions?: { structuredOutput?: { schema?: unknown } };
      }
    ).defaultOptions;
    expect(defaults?.structuredOutput?.schema).toBe(NarratorOutput);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/agents/narrator.test.ts --run
```

Expected: FAIL with "Cannot find module './narrator'".

- [ ] **Step 3: Implement `src/mastra/agents/narrator.ts`.**

```ts
import { Agent } from '@mastra/core/agent';
import { NarratorOutput } from '@/lib/schemas';
import { loadEntityTool } from '../tools/loadEntity';
import { diceTool } from '../tools/dice';

const SYSTEM_PROMPT = `You are the narrator of an ongoing tabletop RPG. The Game Master sends you a dossier each turn with:
- <world>, <character>, <threads>, <style_guide>
- <on_stage>: the NPCs and locations present this turn (with their body text inline)
- <recent_journal>: the last few turns of prose
- <faction_decisions>: short directives from each faction whose member is on stage
- <player_input>: what the player just said or did

Write the next beat of the story as prose. Honor the style guide. Weave in the faction decisions so the world feels reactive — they are not optional, they are what the factions DO this turn. Use [[npcs/slug]] or [[locations/slug]] wikilinks the FIRST time an entity is named in your prose; subsequent mentions are plain. Do NOT include image embeds (![[file.png]]) — the illustrator inserts those after you.

Tools:
- loadEntity({ kind, slug }) — read a vault entity not in <on_stage> (e.g. an NPC the player just named). Use sparingly. If the result is { found: false }, do not invent — either skip the detail or write the prose as if the entity is generic / unfamiliar.
- dice({ expression }) — roll dice mid-prose when the fiction demands it (a fight, a check, a contested action). Valid expressions: 2d6, 2d6+1, pbta, pbta+2, advantage, disadvantage, 1d20, etc. If the tool errors, retry with a valid expression. Surface dice outcomes in the prose; the playtest log captures the raw rolls automatically.

Return a JSON object:
- prose: the full narration for this turn, in markdown. One to a few paragraphs.
- time_passed (optional): { days?: number, hours?: number }. Only set this if the fiction explicitly advances the world clock (a journey, a long rest, scene cuts to "the next morning"). When set, the workflow will tick threads forward by that amount. Omit otherwise.`;

export const narratorAgent = new Agent({
  id: 'narrator',
  name: 'Narrator Agent',
  description:
    'Writes the per-turn prose. Returns { prose, time_passed? } given a dossier with on-stage entities, recent journal, faction decisions, and the player input.',
  instructions: {
    role: 'system',
    content: SYSTEM_PROMPT,
    providerOptions: {
      openai: { reasoningEffort: 'high' },
    },
  },
  model: 'openai/gpt-5.5',
  tools: {
    loadEntity: loadEntityTool,
    dice: diceTool,
  },
  defaultOptions: {
    structuredOutput: {
      schema: NarratorOutput,
    },
  },
});
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest src/mastra/agents/narrator.test.ts --run
```

Expected: all narrator-agent tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/agents/narrator.ts src/mastra/agents/narrator.test.ts
git commit -m "feat(agents): narrator agent with loadEntity + dice tools and NarratorOutput"
```

---

## Task 6: `illustrator` agent

**Files:**

- Create: `src/mastra/agents/illustrator.ts`
- Test: `src/mastra/agents/illustrator.test.ts`

The illustrator gets the narrator's prose plus the `## Visual` style block and the on-stage entities, fires 0-3 parallel `image` tool calls, and returns `{ prose_with_embeds, images }` — the narrator's prose with `![[file.png]]` embeds inserted at the right beats.

- [ ] **Step 1: Write failing test.**

Create `src/mastra/agents/illustrator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { illustratorAgent } from './illustrator';
import { IllustratorOutput } from '@/lib/schemas';

describe('illustratorAgent', () => {
  it('has id "illustrator" and model "openai/gpt-5.5"', () => {
    expect(illustratorAgent.id).toBe('illustrator');
    const model: unknown =
      (illustratorAgent as unknown as { model?: unknown }).model ??
      (illustratorAgent as unknown as { modelId?: unknown }).modelId;
    expect(model).toBe('openai/gpt-5.5');
  });

  it('wires the image tool', async () => {
    const tools = await illustratorAgent.getTools?.({ requestContext: {} as any });
    expect(tools).toBeDefined();
    expect(Object.keys(tools as Record<string, unknown>)).toEqual(['image']);
  });

  it('wires IllustratorOutput as its default structured output schema', () => {
    const defaults = (
      illustratorAgent as unknown as {
        defaultOptions?: { structuredOutput?: { schema?: unknown } };
      }
    ).defaultOptions;
    expect(defaults?.structuredOutput?.schema).toBe(IllustratorOutput);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/agents/illustrator.test.ts --run
```

Expected: FAIL with "Cannot find module './illustrator'".

- [ ] **Step 3: Implement `src/mastra/agents/illustrator.ts`.**

```ts
import { Agent } from '@mastra/core/agent';
import { IllustratorOutput } from '@/lib/schemas';
import { imageTool } from '../tools/image';

const SYSTEM_PROMPT = `You are the illustrator for an ongoing tabletop RPG. The Game Master sends you:
- <visual_style>: the project's ## Visual block — the visual contract for every image (medium, palette, mood, framing).
- <narrator_prose>: the prose the narrator just wrote for this turn.
- <on_stage>: the NPCs and locations present this turn (with body text).

Decide whether the turn warrants 0, 1, 2, or 3 illustrations. Be selective — most turns warrant 0 or 1. Strong candidates: a new location revealed, a striking visual beat (a duel, a vista, a face glimpsed for the first time), or a moment the narrator's prose centers on a single image. Weak candidates: a conversation, a beat of internal reflection, a quick aside.

For each illustration you choose:
1. Compose a prompt by writing a short visual description of the scene IN YOUR OWN WORDS. The workflow will not prepend the style guide for you — you must include the ## Visual block's directives in every prompt yourself (medium, palette, mood, etc.). Be specific about the subject, framing, and lighting.
2. Pick a short kebab-case slug for the filename (e.g. "kessha-helm", "iron-promise-night").
3. Call the image tool: image({ prompt, slug }). It returns { filename, path, prompt, slug }.

Then return a JSON object:
- prose_with_embeds: the narrator's prose, edited only to insert ![[<filename>.png]] at the right beats. Do NOT change the narrator's words — only insert image embeds on their own lines. If you produced 0 images, prose_with_embeds equals the narrator's prose verbatim.
- images: the array of ImageMeta records returned by your image tool calls, in the order the embeds appear in the prose.

If an image tool call fails, drop that embed and continue with one fewer image. Never invent a filename you didn't get back from the tool.`;

export const illustratorAgent = new Agent({
  id: 'illustrator',
  name: 'Illustrator Agent',
  description:
    'Selects 0-3 scenes from the narrator prose, generates images via the image tool, and returns { prose_with_embeds, images }.',
  instructions: {
    role: 'system',
    content: SYSTEM_PROMPT,
    providerOptions: {
      openai: { reasoningEffort: 'high' },
    },
  },
  model: 'openai/gpt-5.5',
  tools: {
    image: imageTool,
  },
  defaultOptions: {
    structuredOutput: {
      schema: IllustratorOutput,
    },
  },
});
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm vitest src/mastra/agents/illustrator.test.ts --run
```

Expected: all illustrator-agent tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/mastra/agents/illustrator.ts src/mastra/agents/illustrator.test.ts
git commit -m "feat(agents): illustrator agent with image tool and IllustratorOutput"
```

---

## Task 7: Register agents in `src/mastra/index.ts` and remove weather scaffolding

**Files:**

- Modify: `src/mastra/index.ts`
- Delete: `src/mastra/agents/weather-agent.ts`
- Delete: `src/mastra/tools/weather-tool.ts`
- Delete: `src/mastra/workflows/weather-workflow.ts`

The current `src/mastra/index.ts` registers the leftover `weatherWorkflow` and `weatherAgent`. Wave 4 swaps them out for the three RPG agents. There is no Wave-4 workflow yet — that's Wave 5 — so the `workflows` key is set to `{}` (Mastra accepts an empty object). Storage, logger, and observability blocks are untouched.

- [ ] **Step 1: Write a failing test that asserts Mastra exposes the three RPG agents and no weather scaffolding.**

Create `src/mastra/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mastra } from './index';

describe('mastra registration', () => {
  it('registers narrator, faction, illustrator', () => {
    const agents = mastra.getAgents();
    expect(Object.keys(agents).sort()).toEqual([
      'factionAgent',
      'illustratorAgent',
      'narratorAgent',
    ]);
  });

  it('does not register weather-agent / weather-workflow', () => {
    const agents = mastra.getAgents();
    expect(agents).not.toHaveProperty('weatherAgent');
    const workflows = mastra.getWorkflows();
    expect(workflows).not.toHaveProperty('weatherWorkflow');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm vitest src/mastra/index.test.ts --run
```

Expected: FAIL — current index.ts registers `weatherAgent` and `weatherWorkflow` and does NOT register the three RPG agents.

- [ ] **Step 3: Update `src/mastra/index.ts`.**

Replace the file with:

```ts
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { narratorAgent } from './agents/narrator';
import { factionAgent } from './agents/faction';
import { illustratorAgent } from './agents/illustrator';

export const mastra = new Mastra({
  workflows: {},
  agents: { narratorAgent, factionAgent, illustratorAgent },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: 'file:./mastra.db',
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new DefaultExporter(), new CloudExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
```

- [ ] **Step 4: Delete the weather scaffolding files.**

```bash
git rm src/mastra/agents/weather-agent.ts \
       src/mastra/tools/weather-tool.ts \
       src/mastra/workflows/weather-workflow.ts
```

- [ ] **Step 5: Run the registration test to verify it now passes.**

```bash
pnpm vitest src/mastra/index.test.ts --run
```

Expected: registration test PASSES.

- [ ] **Step 6: Run the entire test suite to confirm no regression.**

```bash
pnpm test --run
```

Expected: all tests across Waves 1-4 PASS. (Coverage on the new Wave-4 surface is enforced via Task 9 below.)

- [ ] **Step 7: Run lint and typecheck.**

```bash
pnpm lint
```

Expected: zero ESLint errors. If TypeScript surfaces an error here (Next.js's ESLint config includes the TS plugin) — fix it before moving on.

- [ ] **Step 8: Commit.**

```bash
git add src/mastra/index.ts src/mastra/index.test.ts
git commit -m "feat(mastra): register narrator/faction/illustrator agents; drop weather scaffolding"
```

---

## Task 8: Manual Studio smoke test (no code changes)

**Files:** none. This is the spec's exit criterion "All three agents callable from Mastra Studio (`pnpm dev`) with hand-built dossiers."

The pipeline executes this as a documented manual check before the human-merge gate. The orchestrator does not block on it — failures here are filed as separate tickets.

- [ ] **Step 1: Start Mastra Studio.**

```bash
pnpm dev
```

Expected: Studio is reachable at `http://localhost:4111`. The agent panel lists `narrator`, `faction`, `illustrator` (no `weather-agent`).

- [ ] **Step 2: In Studio, invoke `faction` with a minimal hand-built dossier string** (paste verbatim):

```
<world calendar="Northern" date="Spring of 1894"><region>The Strake</region><city>Iron Promise</city><weather>cold rain</weather><season>spring</season></world>
<character><name>Vex</name><role>Smuggler</role></character>
<faction slug="red-banner">The Red Banner enforces dockside extortion in Iron Promise. Their captain is Kessha.</faction>
<on_stage><npc slug="kessha" faction="red-banner">Kessha is the Red Banner's captain. Volatile, holds a grudge.</npc></on_stage>
<recent_journal>(none — first turn)</recent_journal>
<player_input>I tell Kessha I will not pay her tax this week.</player_input>
```

Expected: a response with `decision` (a short faction action) and `reasoning` (a short rationale). Both non-empty strings. No schema validation error.

- [ ] **Step 3: In Studio, invoke `narrator`** with a hand-built dossier that includes the faction decision from Step 2 (paste and edit). Expected: a `prose` field (markdown narration mentioning Kessha and the faction's decision) and optional `time_passed`. May see a `dice` or `loadEntity` tool call in the trace pane.

- [ ] **Step 4: In Studio, invoke `illustrator`** with the narrator's `prose` from Step 3 wrapped as:

```
<visual_style>Ink-and-wash sketches, sepia and bone-white, low contrast, candlelit interiors.</visual_style>
<narrator_prose>{paste the prose}</narrator_prose>
<on_stage>{paste from Step 2}</on_stage>
```

Expected: `prose_with_embeds` either matches the input prose verbatim (zero images) or has `![[...png]]` lines inserted, and `images` is an array of 0-3 `ImageMeta` records. **Tooling note:** this step actually hits `gpt-image-2` if illustrator chooses to call the tool, so a small OpenAI bill is real. If a key is not present, expect a tool error in the trace and a `prose_with_embeds` equal to the input prose.

- [ ] **Step 5: Stop Mastra Studio (`Ctrl+C`) and record the manual smoke result in the PR description.**

---

## Task 9: Extend coverage gate to the Wave-4 surface

**Files:**

- Modify: `vitest.config.ts`

The Wave-3 commit extended the coverage gate to cover `src/lib/schemas.ts`, `src/lib/dossier.ts`, and `src/lib/media/**`. Wave 4 adds production code in `src/mastra/tools/**` and `src/mastra/agents/**` that should be held to the same 80% bar. The construction tests for agents are minimal; the tool tests are real unit tests against real logic.

- [ ] **Step 1: Read the current config.**

```bash
cat vitest.config.ts
```

Expected: the existing `coverage.include` lists `src/lib/vault/**/*.ts`, `src/lib/schemas.ts`, `src/lib/dossier.ts`, `src/lib/media/**/*.ts`.

- [ ] **Step 2: Extend the `include` array to also cover `src/mastra/tools/**/_.ts`and`src/mastra/agents/\*\*/_.ts`.\*\*

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/lib/vault/**/*.ts',
        'src/lib/schemas.ts',
        'src/lib/dossier.ts',
        'src/lib/media/**/*.ts',
        'src/mastra/tools/**/*.ts',
        'src/mastra/agents/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
```

- [ ] **Step 3: Run coverage and confirm the new surface meets the 80% gate.**

```bash
pnpm test:coverage
```

Expected: PASS, with lines/functions/branches/statements all ≥80% across the new include patterns. If any agent file falls below 80% because the construction tests don't exercise some branch, you have two options:

1. Add a test that covers the branch (preferred for the tools).
2. Demonstrate that the un-covered branch is a thin SDK wrapper (e.g. the `Agent` constructor) where adding a test would only test the SDK. In that case, the natural fix is to keep the surface so thin that lines/branches stays trivially above the gate — the agent files in this plan stay ~30 LOC of real code each (the system prompt is a constant string and doesn't count toward branches).

- [ ] **Step 4: Commit.**

```bash
git add vitest.config.ts
git commit -m "chore(test): extend coverage gate to Wave 4 tools and agents"
```

---

## Final verification

Run the whole suite, lint, and (informational) coverage one more time before declaring the wave done.

- [ ] **Step 1: Full test suite green.**

```bash
pnpm test --run
```

Expected: PASS. Tests across Waves 1-4 inclusive.

- [ ] **Step 2: Lint clean.**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 3: Format check.**

```bash
pnpm format:check
```

Expected: zero diff. (The Claude PostToolUse hook should have auto-formatted on every edit, so this is a belt-and-suspenders check.)

- [ ] **Step 4: Coverage gate green.**

```bash
pnpm test:coverage
```

Expected: PASS with thresholds met on the Wave-4 surface.

- [ ] **Step 5: Build succeeds.**

```bash
pnpm build
```

Expected: Next.js + Mastra production build succeeds. (The Mastra runtime is sometimes pickier about ESM resolution at build time than at test time; if this fails, do not paper over it — it indicates a real issue in the agent/tool wiring.)

- [ ] **Step 6: Confirm the spec's exit criteria are met.**
  - [ ] `dice` tool handles `2d6+1`, `pbta+2`, `advantage`/`disadvantage`; invalid expressions throw and the agent will retry (verified by unit tests in Task 1).
  - [ ] `loadEntity` returns `{ found: false }` for missing slugs (verified by unit tests in Task 2).
  - [ ] All three agents are constructible with the right model, tool keys, and structured-output schema (verified in Tasks 4-6).
  - [ ] All three agents are registered in `src/mastra/index.ts` and the weather scaffolding is gone (verified in Task 7).
  - [ ] Manual Studio smoke documented in the PR description (Task 8). Not blocking — the spec calls it an exit criterion but neither CI nor the human-merge gate can automate it.
  - [ ] Code compiles (`pnpm build`), lints clean (`pnpm lint`), prior wave tests still pass (`pnpm test`).

---

## Self-review checklist

**Spec coverage:**

- ✓ `src/mastra/tools/dice.ts` — Task 1, ~110 LOC implementation (spec says ~50; we run a bit over to support both `pbta` and `pbta+K` plus advantage/disadvantage cleanly).
- ✓ `src/mastra/tools/loadEntity.ts` — Task 2, ~80 LOC.
- ✓ `src/mastra/tools/image.ts` — Task 3, ~50 LOC.
- ✓ `src/mastra/agents/narrator.ts` — Task 5, ~50 LOC + ~30 lines of system-prompt string.
- ✓ `src/mastra/agents/faction.ts` — Task 4.
- ✓ `src/mastra/agents/illustrator.ts` — Task 6.
- ✓ `src/mastra/index.ts` updates — Task 7.
- ✓ Exit criterion "All three agents callable from Mastra Studio" — Task 8 (manual).
- ✓ Exit criterion "dice tool handles..." — Task 1 tests.
- ✓ Exit criterion "loadEntity returns { found: false }" — Task 2 tests.
- ✓ Exit criterion "weather-agent / weather-workflow removed" — Task 7.
- ✓ Exit criterion "Code compiles, lints clean, prior wave tests still pass" — Final verification.

**Placeholder scan:** No "TBD" / "implement later" / "add appropriate error handling" / "similar to Task N" references. Every code step has complete code. Every test step has complete test code.

**Type consistency:**

- `EntityKind` in `loadEntity.ts` is `'npc' | 'faction' | 'location'`. Same enum used in the output schema and the dispatch.
- `ImageMeta` in the `image` tool's output schema is the exact `ImageMeta` symbol imported from `@/lib/schemas` — no re-definition.
- `FactionOutput` / `NarratorOutput` / `IllustratorOutput` are referenced by the same names used in Wave 3's `schemas.ts`.
- `vaultRoot(slug)` signature matches Wave 1's `paths.ts` export.
- `generateImage({ prompt, slug, vaultRoot, deps? })` shape matches Wave 3's `media/image.ts` export (`apiKey`, `size`, `quality` are optional and we don't pass them).
- `Agent` constructor fields (`id`, `name`, `description`, `instructions`, `model`, `tools`, `defaultOptions`) match the SDK reference docs and the existing `weather-agent` pattern.
- `createTool` signature (`{ id, description, inputSchema, outputSchema, execute }`) matches the SDK reference docs and the existing `weather-tool` pattern.

**Scope:** Wave 4 only. No workflow orchestration (Wave 5), no API route (Wave 6), no UI (Wave 6). Each task is independently testable and commits a working slice.
