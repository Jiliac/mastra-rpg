/**
 * Live smoke test for the per-turn workflow. NOT part of CI; not bundled into
 * the Next.js build. Costs real OpenAI + Inworld credits — run manually.
 *
 *   pnpm tsx scripts/smoke-turn.ts --vault <abs-path> --input "<player input>"
 *
 * Requires OPENAI_API_KEY and INWORLD_API_KEY in env.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mastra } from '../src/mastra/index';
import { runTurn, type AgentLike } from '../src/mastra/workflows/turn';
import { ttsRender } from '../src/lib/media/tts';
import type { FactionOutput, IllustratorOutput, NarratorOutput } from '../src/lib/schemas';

function parseArgs(argv: string[]): { vault: string; input: string } {
  const out: Partial<{ vault: string; input: string }> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault') out.vault = argv[++i];
    else if (arg === '--input') out.input = argv[++i];
  }
  if (!out.vault || !out.input) {
    console.error('Usage: pnpm tsx scripts/smoke-turn.ts --vault <path> --input "<text>"');
    process.exit(2);
  }
  return { vault: path.resolve(out.vault), input: out.input };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fs.access(args.vault);
  console.log(`[smoke] vault: ${args.vault}`);
  console.log(`[smoke] input: ${args.input}`);
  const narrator = mastra.getAgent('narratorAgent') as unknown as AgentLike<NarratorOutput>;
  const faction = mastra.getAgent('factionAgent') as unknown as AgentLike<FactionOutput>;
  const illustrator = mastra.getAgent(
    'illustratorAgent',
  ) as unknown as AgentLike<IllustratorOutput>;
  const t0 = Date.now();
  const result = await runTurn(
    { vaultRoot: args.vault, playerInput: args.input },
    {
      narratorAgent: narrator,
      factionAgent: faction,
      illustratorAgent: illustrator,
      ttsRender: (text, opts) => ttsRender(text, { output: opts.output, voice: opts.voice }),
      emit: (e) => {
        if (e.type === 'prose_delta') process.stdout.write(e.text);
        else if (e.type === 'phase')
          console.log(`\n[phase] ${e.name}${'count' in e ? ` (count=${e.count})` : ''}`);
        else if (e.type === 'error')
          console.error(`\n[error] ${e.message} (recoverable=${e.recoverable})`);
        else if (e.type === 'done')
          console.log(`\n[done] audio=${e.audioPath}, images=${e.images.length}`);
      },
    },
  );
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[smoke] elapsed: ${dt}s`);
  if (result.status !== 'success') {
    console.error(`[smoke] FAILED: ${result.message}`);
    process.exit(1);
  }
  console.log(
    `[smoke] OK: turn=${result.turnId}, audio=${result.audioPath}, images=${result.images.length}, matured=${result.matured.length}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
