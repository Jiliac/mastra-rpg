// src/lib/sse/serialize.ts
//
// Serialize a PhaseEvent to a single SSE record. SSE wire format per the
// HTML Living Standard "Server-sent events" section:
//
//   event: <type>\n
//   data: <single-line JSON>\n
//   \n                                   <- trailing blank line is mandatory
//
// A heartbeat is a comment record:
//
//   : heartbeat\n
//   \n

import type { PhaseEvent } from './events';

export function serializeEvent(ev: PhaseEvent): string {
  // JSON.stringify never emits a literal newline, so a single `data: ...` line
  // is always sufficient. No need to split multi-line payloads.
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

export function serializeHeartbeat(): string {
  return `: heartbeat\n\n`;
}
