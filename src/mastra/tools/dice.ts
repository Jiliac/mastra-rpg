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
    // Upper bounds prevent DoS via `999999d999999` from an adversarial / hallucinated prompt.
    if (n <= 0 || m <= 0 || n > 100 || m > 1000) {
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
  execute: async (inputData) => {
    return rollDice(inputData.expression);
  },
});
