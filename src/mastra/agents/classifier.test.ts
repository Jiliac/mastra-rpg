import { describe, it, expect } from 'vitest';
import { classifierAgent } from './classifier';
import { ClassifierOutput } from '@/lib/schemas';

const REQ_CTX = {} as never;

describe('classifierAgent', () => {
  it('has id "classifier" and uses the cheap mini model', () => {
    expect(classifierAgent.id).toBe('classifier');
    expect(classifierAgent.model).toBe('openai/gpt-5.4-mini');
  });

  it('has no tools', async () => {
    const tools = await classifierAgent.getToolsForExecution({ requestContext: REQ_CTX });
    expect(Object.keys(tools)).toEqual([]);
  });

  it('wires ClassifierOutput as its default structured output schema', async () => {
    const defaults = await classifierAgent.getDefaultOptions({ requestContext: REQ_CTX });
    expect(defaults.structuredOutput?.schema).toBe(ClassifierOutput);
  });
});
