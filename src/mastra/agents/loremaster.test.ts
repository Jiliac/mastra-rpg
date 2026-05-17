import { describe, it, expect } from 'vitest';
import { loremasterAgent } from './loremaster';

const REQ_CTX = {} as never;

describe('loremasterAgent', () => {
  it('has id "loremaster" and uses the full gpt-5.5 model', () => {
    expect(loremasterAgent.id).toBe('loremaster');
    expect(loremasterAgent.model).toBe('openai/gpt-5.5');
  });

  it('has no tools (OOC answers never roll dice or load entities)', async () => {
    const tools = await loremasterAgent.getToolsForExecution({ requestContext: REQ_CTX });
    expect(Object.keys(tools)).toEqual([]);
  });

  it('uses plain-text streaming (no structuredOutput schema)', async () => {
    const defaults = await loremasterAgent.getDefaultOptions({ requestContext: REQ_CTX });
    expect(defaults.structuredOutput).toBeUndefined();
  });
});
