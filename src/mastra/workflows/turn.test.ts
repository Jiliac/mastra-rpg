/**
 * Layer-2 integration tests for the Wave-5 turn workflow.
 *
 * Eight canonical scenarios from the spec (lines 397-408):
 *   1. Happy path (Task 7).
 *   2. Faction validation fails × 2 → synth `[no response]` (Task 4).
 *   3. Narrator validation fails × 2 → recoverable error, no journal append (Task 5).
 *   4. Concurrent turns: 2nd request bounces with mutex contention (Task 2).
 *   5. Image gen fails → illustrator drops embed, turn completes (Task 6/7).
 *   6. TTS fails × 2 → recoverable error, no journal append (Task 6).
 *   7. Mid-step crash releases mutex (Task 8).
 *   8. Stub-on-mention cap: 2 stubs + overflow to 0-Map (Task 9).
 *
 * Plus the empty-faction-list non-failure (self-review §7, promoted into
 * Task 9 per reviewer nit 5), and a `[faction file missing]` fallback test
 * (reviewer nit 4).
 *
 * Each test runs against its own copy of the fixture vault under tmpdir so
 * filesystem mutation does not bleed between tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runTurn, generateWithRetry, type AgentLike, type PhaseEvent } from './turn';
import { acquireMutex, releaseMutex, isLocked } from '@/lib/vault/lock';
import { FactionOutput as FactionOutputSchema } from '@/lib/schemas';
import type { FactionOutput, IllustratorOutput, NarratorOutput } from '@/lib/schemas';
import { copyFixtureVault, makeMockAgent, makeAgentStream, collectEvents } from './turn.harness';

const FIXTURE = path.resolve(__dirname, '../../../tests/fixtures/test-vault');

describe('runTurn — Step 1: lock + dossier prep', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('Scenario 4: mutex contended → error{recoverable:true}, other holder keeps lock', async () => {
    expect(acquireMutex(path.basename(vault))).toBe(true);
    const { events, emit } = collectEvents();
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'hello' },
      {
        narratorAgent: makeMockAgent({ outputs: [] }),
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not be called');
        },
        emit,
      },
    );
    expect(result).toEqual({ status: 'error', message: 'still working', recoverable: true });
    expect(events).toEqual([{ type: 'error', message: 'still working', recoverable: true }]);
    expect(isLocked(path.basename(vault))).toBe(true);
  });
});

describe('generateWithRetry', () => {
  it('returns the first output if it validates', async () => {
    const agent = makeMockAgent<FactionOutput>({
      outputs: [{ decision: 'do it', reasoning: 'why' }],
    });
    const out = await generateWithRetry(agent, 'dossier', FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[fallback]' },
      label: 'faction(x)',
    });
    expect(out).toEqual({ decision: 'do it', reasoning: 'why' });
    expect(agent.generateCalls).toHaveLength(1);
  });

  it('retries with feedback after one validation failure, then succeeds', async () => {
    const agent = makeMockAgent<FactionOutput>({
      outputs: [
        { throws: new Error('reasoning: Required') },
        { decision: 'retry win', reasoning: 'second time' },
      ],
    });
    const out = await generateWithRetry(agent, 'dossier', FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[fallback]' },
      label: 'faction(x)',
    });
    expect(out).toEqual({ decision: 'retry win', reasoning: 'second time' });
    expect(agent.generateCalls).toHaveLength(2);
    expect(agent.generateCalls[1]).toContain('VALIDATION ERROR ON PREVIOUS ATTEMPT:');
    expect(agent.generateCalls[1]).toContain('reasoning: Required');
  });

  it('returns the fallback after two validation failures', async () => {
    const agent = makeMockAgent<FactionOutput>({
      outputs: [
        { throws: new Error('decision: Required') },
        { throws: new Error('reasoning: Required') },
      ],
    });
    const out = await generateWithRetry(agent, 'dossier', FactionOutputSchema, {
      fallback: { decision: '[no response]', reasoning: '[fallback]' },
      label: 'faction(x)',
    });
    expect(out).toEqual({ decision: '[no response]', reasoning: '[fallback]' });
    expect(agent.generateCalls).toHaveLength(2);
  });
});

describe('runTurn — Step 2: faction fan-out', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('emits phase{factions, count:N} then narrator after parallel decisions', async () => {
    const { events, emit } = collectEvents();
    const factionAgent = makeMockAgent<FactionOutput>({
      outputs: [{ decision: 'red-banner moves', reasoning: 'r1' }],
    });
    // Make narrator throw so we stop after Step 3 start; assert Step 1-2 ran correctly.
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: async () => {
        throw new Error('narrator unwired');
      },
      stream: async () => {
        throw new Error('narrator unwired');
      },
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I look for [[npcs/kessha|Kessha]]' },
      {
        narratorAgent,
        factionAgent,
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not be called');
        },
        emit,
      },
    );
    expect(result.status).toBe('error');
    const phases = events.filter((e) => e.type === 'phase') as Extract<
      PhaseEvent,
      { type: 'phase' }
    >[];
    expect(phases[0]).toEqual({ type: 'phase', name: 'factions', count: 1 });
    expect(phases[1]).toEqual({ type: 'phase', name: 'narrator' });
    expect(factionAgent.generateCalls).toHaveLength(1);
    expect(factionAgent.generateCalls[0]).toContain('<faction slug="red-banner">');
  });

  it('Scenario 2: synthesises [no response] when faction validation fails twice', async () => {
    const { emit } = collectEvents();
    const factionAgent = makeMockAgent<FactionOutput>({
      outputs: [
        { throws: new Error('decision: Required') },
        { throws: new Error('decision: Required') },
      ],
    });
    const narratorAgent = makeMockAgent<NarratorOutput>({
      outputs: [{ prose: 'After silence, the world held its breath.' }],
    });
    await runTurn(
      { vaultRoot: vault, playerInput: 'I look for [[npcs/kessha|Kessha]]' },
      {
        narratorAgent,
        factionAgent,
        illustratorAgent: makeMockAgent<IllustratorOutput>({
          outputs: [{ throws: new Error('step-4 wip') }],
        }),
        ttsRender: async () => {
          throw new Error('should not be called');
        },
        emit,
      },
    );
    const narratorPrompt = narratorAgent.streamCalls[0] ?? narratorAgent.generateCalls[0] ?? '';
    expect(narratorPrompt).toContain('<decision faction="red-banner">[no response]</decision>');
    expect(factionAgent.generateCalls).toHaveLength(2);
  });

  it('Nit 4: synthesises [faction file missing] when NPC.frontmatter.faction has no file', async () => {
    // Mutate the fixture copy: add an NPC whose `faction` slug has no
    // matching factions/<slug>.md file. This exercises the inline defensive
    // branch in runTurn (`if (!factionDoc)`).
    await fs.writeFile(
      path.join(vault, 'npcs', 'ghost.md'),
      [
        '---',
        'aliases: [Ghost]',
        'tags: [npc]',
        'faction: ghost-clan',
        '---',
        '',
        '# Ghost',
        '',
        'Tied to a faction with no file.',
        '',
      ].join('\n'),
      'utf8',
    );
    // Wipe journal so Kessha (and her faction red-banner) is NOT on stage:
    // we want only the ghost-clan defensive branch to fire.
    await fs.writeFile(path.join(vault, 'journal.md'), '# Journal\n', 'utf8');
    const { emit } = collectEvents();
    // Faction agent should NEVER be invoked because the workflow short-circuits.
    const factionAgent = makeMockAgent<FactionOutput>({ outputs: [] });
    // Narrator throws so we exit early; the prompt should still contain the
    // synthesised [faction file missing] decision (proves the short-circuit fired).
    const narratorAgent = makeMockAgent<NarratorOutput>({
      outputs: [{ prose: '...' }],
    });
    await runTurn(
      { vaultRoot: vault, playerInput: 'I greet [[npcs/ghost|Ghost]].' },
      {
        narratorAgent,
        factionAgent,
        illustratorAgent: makeMockAgent<IllustratorOutput>({
          outputs: [{ throws: new Error('step-4 wip') }],
        }),
        ttsRender: async () => {
          throw new Error('should not be called');
        },
        emit,
      },
    );
    const narratorPrompt = narratorAgent.streamCalls[0] ?? narratorAgent.generateCalls[0] ?? '';
    expect(narratorPrompt).toContain('<decision faction="ghost-clan">[no response]</decision>');
    expect(factionAgent.generateCalls).toHaveLength(0);
  });
});

describe('runTurn — Step 3: narrator', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('emits prose_delta events from the streaming agent', async () => {
    const { events, emit } = collectEvents();
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () =>
        makeAgentStream(['Hello, ', 'world. ', 'A test.'], {
          prose: 'Hello, world. A test.',
        }),
    };
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: async () => ({
        object: {
          prose_with_embeds: 'Hello, world. A test.',
          images: [],
        },
      }),
      stream: vi.fn(),
    };
    await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender: async (_t, o) => o.output,
        emit,
      },
    );
    const deltas = events
      .filter((e): e is Extract<PhaseEvent, { type: 'prose_delta' }> => e.type === 'prose_delta')
      .map((e) => e.text);
    expect(deltas).toEqual(['Hello, ', 'world. ', 'A test.']);
    const phaseNames = events
      .filter((e): e is Extract<PhaseEvent, { type: 'phase' }> => e.type === 'phase')
      .map((e) => e.name);
    expect(phaseNames.slice(0, 3)).toEqual(['factions', 'narrator', 'media']);
  });

  it('Scenario 3: narrator failed twice → error{recoverable:true}, no journal append', async () => {
    const journalBefore = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(async () => {
        throw new Error('prose: Required');
      }),
      stream: vi.fn(async () => ({
        textStream: (async function* () {
          yield '';
        })(),
        object: Promise.reject(new Error('prose: Required')),
      })),
    };
    const { events, emit } = collectEvents();
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not be called');
        },
        emit,
      },
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.recoverable).toBe(true);
      expect(result.message).toBe('narrator failed; please rephrase');
    }
    const journalAfter = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journalAfter).toEqual(journalBefore);
    expect(isLocked(path.basename(vault))).toBe(false);
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'narrator failed; please rephrase',
      recoverable: true,
    });
  });
});

describe('runTurn — Step 4: illustrator || TTS', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('runs illustrator and TTS in parallel (both start before either resolves)', async () => {
    // Deterministic gate (reviewer nit 1): both calls must enter their bodies
    // before either resolves. We wire a Promise that resolves only after BOTH
    // entry deferreds fire; if anyone awaited sequentially it would deadlock.
    let ttsEntered: () => void = () => {};
    let illusEntered: () => void = () => {};
    const ttsEnteredP = new Promise<void>((r) => {
      ttsEntered = r;
    });
    const illusEnteredP = new Promise<void>((r) => {
      illusEntered = r;
    });
    const bothEntered = Promise.all([ttsEnteredP, illusEnteredP]);

    const { events, emit } = collectEvents();
    const narratorOutput: NarratorOutput = { prose: 'A beat of prose.' };
    const illustratorOutput: IllustratorOutput = {
      prose_with_embeds: 'A beat of prose.\n\n![[a-b-c.png]]',
      images: [{ filename: 'a-b-c.png', path: '/abs/a-b-c.png', prompt: 'p', slug: 's' }],
    };
    const ttsRender = vi.fn(async (_text: string, opts: { output: string }) => {
      ttsEntered();
      await bothEntered;
      return opts.output;
    });
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: async () => {
        illusEntered();
        await bothEntered;
        return { object: illustratorOutput };
      },
      stream: vi.fn(),
    };
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () => makeAgentStream([''], narratorOutput),
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender,
        emit,
      },
    );
    expect(result.status).toBe('success');
    // phase: persist fires AFTER both promises settle, AFTER phase: media:
    expect(events.some((e) => e.type === 'phase' && e.name === 'persist')).toBe(true);
  });

  it('Scenario 5: image gen failure → illustrator falls back to no embeds, turn completes', async () => {
    const { events, emit } = collectEvents();
    const narratorOutput: NarratorOutput = { prose: 'A beat.' };
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () => makeAgentStream([''], narratorOutput),
    };
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new Error('OpenAI 500'))
        .mockRejectedValueOnce(new Error('OpenAI 500')),
      stream: vi.fn(),
    };
    const ttsRender = vi.fn(async (_t: string, o: { output: string }) => o.output);
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender,
        emit,
      },
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      // Fallback shape: empty images, narrator prose carried forward as-is.
      expect(result.images).toEqual([]);
      expect(result.finalProse).toBe('A beat.');
    }
    expect(illustratorAgent.generate).toHaveBeenCalledTimes(2);
    // Journal has no image embeds:
    const journal = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journal).not.toContain('![[');
    void events;
  });

  it('Scenario 6: TTS fails twice → error{recoverable:true}, no journal append', async () => {
    // Reviewer nit 3 (fake timers) was attempted but `runAllTimersAsync`
    // interleaves poorly with the workflow's async chain. Keep real-clock —
    // 200ms backoff is the only real wall-clock in this test; acceptable.
    const journalBefore = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    const { emit } = collectEvents();
    const narratorOutput: NarratorOutput = { prose: 'A beat.' };
    const narratorAgent: AgentLike<NarratorOutput> = {
      generate: vi.fn(),
      stream: async () => makeAgentStream([''], narratorOutput),
    };
    const illustratorAgent: AgentLike<IllustratorOutput> = {
      generate: async () => ({
        object: { prose_with_embeds: 'A beat.', images: [] },
      }),
      stream: vi.fn(),
    };
    const ttsRender = vi.fn(async () => {
      throw new Error('Inworld 500');
    });
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent,
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent,
        ttsRender,
        emit,
      },
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.recoverable).toBe(true);
      expect(result.message).toBe('audio render failed');
    }
    expect(ttsRender).toHaveBeenCalledTimes(2);
    const journalAfter = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journalAfter).toEqual(journalBefore);
    expect(isLocked(path.basename(vault))).toBe(false);
  });
});

describe('runTurn — Step 5: persist (Scenario 1: happy path)', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('Scenario 1: appends journal, ticks world, writes playtest, emits done', async () => {
    const { events, emit } = collectEvents();
    const narratorOutput: NarratorOutput = {
      prose: 'Kessha turned to the sea.',
      time_passed: { days: 1 },
    };
    const illustratorOutput: IllustratorOutput = {
      prose_with_embeds: 'Kessha turned to the sea.\n\n![[scene-001.png]]',
      images: [{ filename: 'scene-001.png', path: '/x/scene-001.png', prompt: 'p', slug: 'scene' }],
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I find [[npcs/kessha|Kessha]].' },
      {
        narratorAgent: {
          generate: vi.fn(),
          stream: async () => makeAgentStream([''], narratorOutput),
        },
        factionAgent: makeMockAgent<FactionOutput>({
          outputs: [{ decision: 'd', reasoning: 'r' }],
        }),
        illustratorAgent: {
          generate: async () => ({ object: illustratorOutput }),
          stream: vi.fn(),
        },
        ttsRender: async (_t, o) => o.output,
        emit,
      },
    );
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.turnId).toMatch(/^turn-\d{3,}$/);
    const journal = await fs.readFile(path.join(vault, 'journal.md'), 'utf8');
    expect(journal).toContain(`— ${result.turnId}`);
    expect(journal).toContain('![[scene-001.png]]');
    const playtestDir = path.join(vault, 'playtests');
    const playtestFiles = await fs.readdir(playtestDir);
    expect(playtestFiles.length).toBeGreaterThan(0);
    const playtest = await fs.readFile(path.join(playtestDir, playtestFiles[0]), 'utf8');
    expect(playtest).toContain(`## ${result.turnId}`);
    // World ticked: mid-clock 4/7 → 5/7.
    const threads = await fs.readFile(path.join(vault, 'threads.xml'), 'utf8');
    expect(threads).toContain('<progress>5/7</progress>');
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      audioPath: expect.stringContaining(`narrator-${result.turnId}.ogg`),
      finalProse: illustratorOutput.prose_with_embeds,
      images: illustratorOutput.images,
    });
    expect(isLocked(path.basename(vault))).toBe(false);
  });
});

describe('runTurn — Scenario 7: mid-step crash releases mutex', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('Scenario 7a: Step 1 throw (missing vault) → mutex released, error event', async () => {
    const bogus = path.join(vault, 'does-not-exist');
    const { events, emit } = collectEvents();
    const result = await runTurn(
      { vaultRoot: bogus, playerInput: 'x' },
      {
        narratorAgent: makeMockAgent({ outputs: [] }),
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: makeMockAgent({ outputs: [] }),
        ttsRender: async () => {
          throw new Error('should not be called');
        },
        emit,
      },
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.recoverable).toBe(false);
      expect(result.message).toMatch(/^vault write failed:/);
    }
    expect(isLocked(path.basename(bogus))).toBe(false);
    expect(events.at(-1)?.type).toBe('error');
  });

  it('Scenario 7b: Step 5 fs failure (journal write rejects) → mutex released', async () => {
    // Reviewer nit 2 considered `vi.spyOn(fs, 'appendFile')` but ESM forbids
    // spying on namespace exports. Instead, replace journal.md with a
    // directory: `appendJournal`'s `fs.writeFile` then rejects with EISDIR
    // regardless of process uid / ACLs. Reliable on darwin + linux + ci.
    await fs.rm(path.join(vault, 'journal.md'));
    await fs.mkdir(path.join(vault, 'journal.md'));
    const narratorOutput: NarratorOutput = { prose: 'A beat.' };
    const illustratorOutput: IllustratorOutput = {
      prose_with_embeds: 'A beat.',
      images: [],
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I do nothing.' },
      {
        narratorAgent: {
          generate: vi.fn(),
          stream: async () => makeAgentStream([''], narratorOutput),
        },
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: {
          generate: async () => ({ object: illustratorOutput }),
          stream: vi.fn(),
        },
        ttsRender: async (_t, o) => o.output,
        emit: () => {},
      },
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.recoverable).toBe(false);
      expect(result.message).toMatch(/^vault write failed:/);
    }
    expect(isLocked(path.basename(vault))).toBe(false);
  });
});

describe('runTurn — Scenario 8: stub-on-mention cap', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await copyFixtureVault(FIXTURE);
  });
  afterEach(async () => {
    releaseMutex(path.basename(vault));
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('Scenario 8: 5 unresolved wikilinks → 2 stubs + 3 0-Map TODOs', async () => {
    const finalProse =
      'A test.\n[[npcs/new-one]] and [[npcs/new-two]] and [[npcs/new-three]] ' +
      'and [[locations/new-loc]] and [[Bare Unresolved]].';
    const illustratorOutput: IllustratorOutput = { prose_with_embeds: finalProse, images: [] };
    const narratorOutput: NarratorOutput = { prose: finalProse };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I explore.' },
      {
        narratorAgent: {
          generate: vi.fn(),
          stream: async () => makeAgentStream([''], narratorOutput),
        },
        factionAgent: makeMockAgent({ outputs: [] }),
        illustratorAgent: {
          generate: async () => ({ object: illustratorOutput }),
          stream: vi.fn(),
        },
        ttsRender: async (_t, o) => o.output,
        emit: () => {},
      },
    );
    expect(result.status).toBe('success');
    const npcStubs = await fs.readdir(path.join(vault, 'npcs'));
    expect(npcStubs).toContain('new-one.md');
    expect(npcStubs).toContain('new-two.md');
    expect(npcStubs).not.toContain('new-three.md');
    const locStubs = await fs.readdir(path.join(vault, 'locations'));
    expect(locStubs).not.toContain('new-loc.md');
    const map = await fs.readFile(path.join(vault, '0-Map.md'), 'utf8');
    expect(map).toContain('TODO: stub for [[npcs/new-three]]');
    expect(map).toContain('TODO: stub for [[locations/new-loc]]');
    expect(map).toContain('TODO: stub for [[Bare Unresolved]]');
  });

  it('Nit 5: empty faction list (player-alone) → phase{factions, count:0}, narrator runs', async () => {
    // The fixture journal mentions Kessha (which spawns red-banner). Wipe it
    // so this player input pulls zero NPCs on stage.
    await fs.writeFile(path.join(vault, 'journal.md'), '# Journal\n', 'utf8');
    const { events, emit } = collectEvents();
    const narratorOutput: NarratorOutput = { prose: 'You stand alone.' };
    const illustratorOutput: IllustratorOutput = {
      prose_with_embeds: 'You stand alone.',
      images: [],
    };
    const factionAgent: AgentLike<FactionOutput> = {
      generate: vi.fn(),
      stream: vi.fn(),
    };
    const result = await runTurn(
      { vaultRoot: vault, playerInput: 'I sit and think.' },
      {
        narratorAgent: {
          generate: vi.fn(),
          stream: async () => makeAgentStream([''], narratorOutput),
        },
        factionAgent,
        illustratorAgent: {
          generate: async () => ({ object: illustratorOutput }),
          stream: vi.fn(),
        },
        ttsRender: async (_t, o) => o.output,
        emit,
      },
    );
    expect(result.status).toBe('success');
    expect(events.find((e) => e.type === 'phase' && e.name === 'factions')).toEqual({
      type: 'phase',
      name: 'factions',
      count: 0,
    });
    expect(factionAgent.generate).not.toHaveBeenCalled();
    expect(factionAgent.stream).not.toHaveBeenCalled();
  });
});
