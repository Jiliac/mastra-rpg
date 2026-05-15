// src/lib/sse/parse.ts
//
// SSE parser. Splits a string buffer on the SSE record separator (\n\n),
// pulls `event:` and `data:` lines out of each record, JSON-decodes the
// data, runs a runtime guard, and returns a list of typed PhaseEvents
// plus any trailing partial record (which the caller prepends to the
// next chunk).
//
// Tolerant by design: malformed records are silently dropped.

import type { PhaseEvent } from './events';
import { isPhaseEvent } from './events';

export interface ParseResult {
  events: PhaseEvent[];
  rest: string;
}

export function parseSseChunks(buffer: string): ParseResult {
  if (buffer === '') return { events: [], rest: '' };

  const events: PhaseEvent[] = [];
  const records = buffer.split('\n\n');
  // The last element after split is either '' (buffer ends with \n\n — fully consumed)
  // or a partial trailing record we have to hold for the next chunk.
  const rest = records.pop() ?? '';

  for (const rec of records) {
    if (rec === '') continue;
    // Comment records start with ':' — skip wholesale.
    if (rec.startsWith(':')) continue;

    let data: string | null = null;
    for (const line of rec.split('\n')) {
      if (line.startsWith('data:')) {
        // SSE spec: strip a single leading space after the colon if present.
        data = line.slice(5).replace(/^ /, '');
      }
      // We intentionally do NOT trust the `event:` line — `isPhaseEvent`
      // re-derives type from the JSON payload. (The two should agree;
      // if they don't, the JSON wins and the record is treated normally.)
    }
    if (data === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (!isPhaseEvent(parsed)) continue;
    events.push(parsed);
  }

  return { events, rest };
}
