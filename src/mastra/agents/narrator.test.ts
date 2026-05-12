import { describe, it, expect } from 'vitest';
import { narratorAgent } from './narrator';
import { NarratorOutput } from '@/lib/schemas';

const REQ_CTX = {} as never;

describe('narratorAgent', () => {
  it('has id "narrator" and model "openai/gpt-5.5"', () => {
    expect(narratorAgent.id).toBe('narrator');
    expect(narratorAgent.model).toBe('openai/gpt-5.5');
  });

  it('wires loadEntity and dice as tools', async () => {
    const tools = await narratorAgent.getToolsForExecution({ requestContext: REQ_CTX });
    // Tool keys are derived from the Object key the tool was registered under
    // (formatTools() in chunk-DDFT2H3T.js:28937-28966 only sanitizes keys with
    // invalid chars). `loadEntity` and `dice` are valid identifiers — passed
    // through verbatim. The `tool.id` field does NOT drive the key.
    expect(Object.keys(tools).sort()).toEqual(['dice', 'loadEntity']);
  });

  it('wires NarratorOutput as its default structured output schema', async () => {
    const defaults = await narratorAgent.getDefaultOptions({ requestContext: REQ_CTX });
    expect(defaults.structuredOutput?.schema).toBe(NarratorOutput);
  });
});
