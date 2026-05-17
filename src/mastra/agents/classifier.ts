import { Agent } from '@mastra/core/agent';
import { ClassifierOutput } from '@/lib/schemas';

const SYSTEM_PROMPT = `You route player messages in a tabletop RPG chat.

Decide whether the player's message is:
- A canonical turn — the character does, says, thinks, or attempts something inside the fiction. The world should respond and the moment should be recorded in the journal. Examples: "I draw my blaster", "I ask Kessha about the manifest", "I wait at the bar", "what do I see?", "I look around".
- Out-of-character (OOC) — the player is asking the Game Master a meta question about the campaign, the rules, or what has happened so far. The world should NOT advance and nothing should be written to the journal. Examples: "where are we in the story?", "remind me who Mira is", "what factions are active?", "summarize the last few turns", "what's my inventory?".

Be conservative: when in doubt, treat it as a canonical turn. Only return isOoc=true when the message is clearly a meta question that the player wants answered without advancing the world.

Return a JSON object with exactly two fields:
- isOoc: boolean — true if OOC, false if canonical turn.
- reasoning: one short sentence explaining the classification.`;

export const classifierAgent = new Agent({
  id: 'classifier',
  name: 'Classifier Agent',
  description:
    'Decides per-input whether a player message is a canonical turn or an OOC meta question. Returns { isOoc, reasoning }.',
  instructions: {
    role: 'system',
    content: SYSTEM_PROMPT,
    providerOptions: {
      openai: { reasoningEffort: 'low' },
    },
  },
  model: 'openai/gpt-5.4-mini',
  defaultOptions: {
    structuredOutput: {
      schema: ClassifierOutput,
    },
  },
});
