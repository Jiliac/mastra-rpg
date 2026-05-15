/**
 * Test helpers for `turn.test.ts`. Lives next to the test for discoverability.
 * NOT shipped in production; not counted toward the workflow's LOC budget.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentLike, AgentStreamLike, PhaseEvent } from './turn';

/** Copy the fixture vault into a fresh tmpdir; returns the copy's absolute path. */
export async function copyFixtureVault(source: string): Promise<string> {
  const dst = await fs.mkdtemp(path.join(os.tmpdir(), 'wave5-vault-'));
  await fs.cp(source, dst, { recursive: true });
  return dst;
}

/** Stream that yields the given text deltas then resolves to `object`. */
export function makeAgentStream<T>(deltas: string[], object: T): AgentStreamLike<T> {
  return {
    textStream: (async function* () {
      for (const d of deltas) yield d;
    })(),
    object: Promise.resolve(object),
  };
}

export interface MockAgentConfig<T> {
  /** Sequential outputs returned by generate() / stream(). Index advances per call. */
  outputs: Array<T | { throws: unknown }>;
}

export type MockAgent<T> = AgentLike<T> & {
  generateCalls: string[];
  streamCalls: string[];
};

/** Build a mock agent that returns `outputs[i]` on the i-th call. Throws if past end. */
export function makeMockAgent<T>(config: MockAgentConfig<T>): MockAgent<T> {
  let i = 0;
  const generateCalls: string[] = [];
  const streamCalls: string[] = [];
  const next = (): T => {
    if (i >= config.outputs.length) throw new Error('mock agent: ran out of outputs');
    const entry = config.outputs[i++];
    if (typeof entry === 'object' && entry !== null && 'throws' in entry) {
      throw (entry as { throws: unknown }).throws;
    }
    return entry as T;
  };
  return {
    generate: async (prompt: string) => {
      generateCalls.push(prompt);
      return { object: next() };
    },
    stream: async (prompt: string) => {
      streamCalls.push(prompt);
      const obj = next();
      return makeAgentStream([JSON.stringify(obj)], obj);
    },
    generateCalls,
    streamCalls,
  };
}

export function collectEvents(): { events: PhaseEvent[]; emit: (e: PhaseEvent) => void } {
  const events: PhaseEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}
