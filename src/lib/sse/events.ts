// src/lib/sse/events.ts
//
// The PhaseEvent union is the wire contract between the turn workflow
// (Wave 5) and the chat UI (Wave 6). Wave 5 owns the type definition;
// we re-export it here so the SSE module has a single import path
// (`@/lib/sse/events`) for both the type and the runtime guard.

export { type PhaseEvent } from '@/mastra/workflows/turn';
import type { PhaseEvent } from '@/mastra/workflows/turn';

export type PhaseName = 'factions' | 'narrator' | 'media' | 'persist' | 'ask';

const PHASE_NAMES = new Set<PhaseName>(['factions', 'narrator', 'media', 'persist', 'ask']);

const DONE_MODES = new Set<'canonical' | 'ooc'>(['canonical', 'ooc']);

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
      if (typeof o.finalProse !== 'string') return false;
      if (!Array.isArray(o.images)) return false;
      if (o.audioPath !== null && typeof o.audioPath !== 'string') return false;
      if (o.mode !== undefined && !DONE_MODES.has(o.mode as 'canonical' | 'ooc')) return false;
      return true;
    case 'error':
      return typeof o.message === 'string' && typeof o.recoverable === 'boolean';
    default:
      return false;
  }
}
