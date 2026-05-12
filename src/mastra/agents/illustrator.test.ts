import { describe, it, expect } from 'vitest';
import { illustratorAgent } from './illustrator';
import { IllustratorOutput } from '@/lib/schemas';

// Cast the empty request context once; @mastra/core@1.32.1 declares
// RequestContext as `Map<string, any>`-ish, but the `requestContext` parameter
// on getDefaultOptions / getToolsForExecution is optional and the empty object
// is accepted at runtime (it just falls through to the static defaults).
const REQ_CTX = {} as never;

describe('illustratorAgent', () => {
  it('has id "illustrator" and model "openai/gpt-5.5"', () => {
    expect(illustratorAgent.id).toBe('illustrator');
    expect(illustratorAgent.model).toBe('openai/gpt-5.5');
  });

  it('wires the image tool', async () => {
    const tools = await illustratorAgent.getToolsForExecution({ requestContext: REQ_CTX });
    expect(Object.keys(tools)).toEqual(['image']);
  });

  it('wires IllustratorOutput as its default structured output schema', async () => {
    const defaults = await illustratorAgent.getDefaultOptions({ requestContext: REQ_CTX });
    expect(defaults.structuredOutput?.schema).toBe(IllustratorOutput);
  });
});
