import { describe, it, expect } from 'vitest';
import { factionAgent } from './faction';
import { FactionOutput } from '@/lib/schemas';

// Cast the empty request context once; @mastra/core@1.32.1 declares
// RequestContext as `Map<string, any>`-ish, but the `requestContext` parameter
// on getDefaultOptions / getToolsForExecution is optional and the empty object
// is accepted at runtime (it just falls through to the static defaults).
const REQ_CTX = {} as never;

describe('factionAgent', () => {
  it('has id "faction" and model "openai/gpt-5.5"', () => {
    // `id`, `name`, and `model` are public class fields per agent.d.ts:65-68.
    expect(factionAgent.id).toBe('faction');
    expect(factionAgent.model).toBe('openai/gpt-5.5');
  });

  it('has no tools in v0', async () => {
    // `tools` is a private field (`#private` on agent.d.ts:64); read via the
    // public getter. Returns Promise<Record<string, CoreTool>>.
    const tools = await factionAgent.getToolsForExecution({ requestContext: REQ_CTX });
    expect(Object.keys(tools)).toEqual([]);
  });

  it('wires FactionOutput as its default structured output schema', async () => {
    // `defaultOptions` is private; read via the public getter.
    const defaults = await factionAgent.getDefaultOptions({ requestContext: REQ_CTX });
    expect(defaults.structuredOutput?.schema).toBe(FactionOutput);
  });
});
