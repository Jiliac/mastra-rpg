import { describe, it, expect } from 'vitest';
import { mastra } from './index';

describe('mastra registration', () => {
  it('registers narrator, faction, illustrator', () => {
    // `listAgents()` is the public, plural getter on Mastra@1.32.1
    // (verified at node_modules/@mastra/core/dist/mastra/index.d.ts:591).
    // There is no `getAgents()`.
    const agents = mastra.listAgents();
    expect(Object.keys(agents).sort()).toEqual([
      'factionAgent',
      'illustratorAgent',
      'narratorAgent',
    ]);
  });

  it('does not register weather-agent / weather-workflow', () => {
    const agents = mastra.listAgents();
    expect(agents).not.toHaveProperty('weatherAgent');
    // `listWorkflows()` returns an object map (verified at
    // node_modules/@mastra/core/dist/mastra/index.d.ts:1312).
    const workflows = mastra.listWorkflows();
    expect(workflows).not.toHaveProperty('weatherWorkflow');
  });
});
