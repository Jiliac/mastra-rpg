// src/lib/sse/events.ts
//
// The PhaseEvent union is the wire contract between the turn workflow
// (Wave 5) and the chat UI (Wave 6). Wave 5 owns the type definition;
// we re-export it here so the SSE module has a single import path
// (`@/lib/sse/events`) for both the type and the runtime guard.

export { type PhaseEvent } from '@/mastra/workflows/turn';
import type { PhaseEvent } from '@/mastra/workflows/turn';

export type PhaseName = 'factions' | 'narrator' | 'media' | 'persist';

const PHASE_NAMES = new Set<PhaseName>(['factions', 'narrator', 'media', 'persist']);

/** Cheap runtime guard for parsed JSON. Used by the SSE parser to drop garbage. */
export function isPhaseEvent(x: unknown): x is PhaseEvent {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  switch (o.type) {
    case 'phase':
      if (typeof o.name !== 'string' || !PHASE_NAMES.has(o.name as PhaseName)) return false;
      // factions phase carries a numeric `count`; reducer reads it without a defensive
      // check, so the guard must enforce it (other phase names have no extra fields).
      if (o.name === 'factions' && typeof o.count !== 'number') return false;
      return true;
    case 'prose_delta':
      return typeof o.text === 'string';
    case 'done':
      return (
        typeof o.audioPath === 'string' &&
        typeof o.finalProse === 'string' &&
        Array.isArray(o.images)
      );
    case 'error':
      return typeof o.message === 'string' && typeof o.recoverable === 'boolean';
    default:
      return false;
  }
}
