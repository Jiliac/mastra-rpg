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
