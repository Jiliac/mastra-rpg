// src/lib/sse/reducer.ts
//
// Pure UI state reducer over PhaseEvent. Extracted from the React
// component so it can be node-tested without jsdom.

import type { PhaseEvent } from './events';
import type { ImageMeta } from '@/lib/schemas';

export type PhaseStatus = 'pending' | 'active' | 'done';

export interface PhaseRecord {
  name: 'factions' | 'narrator' | 'media' | 'persist' | 'ask';
  status: PhaseStatus;
  count?: number;
}

export interface UiState {
  phases: PhaseRecord[];
  prose: string;
  finalProse: string | null;
  audioPath: string | null;
  images: ImageMeta[];
  error: { message: string; recoverable: boolean } | null;
  status: 'idle' | 'streaming' | 'done' | 'error';
  mode: 'canonical' | 'ooc';
}

export function initialState(): UiState {
  return {
    phases: [],
    prose: '',
    finalProse: null,
    audioPath: null,
    images: [],
    error: null,
    status: 'idle',
    mode: 'canonical',
  };
}

function markActiveDone(phases: PhaseRecord[]): PhaseRecord[] {
  return phases.map((p) => (p.status === 'active' ? { ...p, status: 'done' as const } : p));
}

export function reducePhaseEvent(state: UiState, ev: PhaseEvent): UiState {
  switch (ev.type) {
    case 'phase': {
      const newRecord: PhaseRecord = {
        name: ev.name,
        status: 'active',
        ...(ev.name === 'factions' ? { count: ev.count } : {}),
      };
      return {
        ...state,
        status: 'streaming',
        phases: [...markActiveDone(state.phases), newRecord],
      };
    }
    case 'prose_delta':
      return { ...state, prose: state.prose + ev.text };
    case 'done':
      return {
        ...state,
        status: 'done',
        phases: markActiveDone(state.phases),
        finalProse: ev.finalProse,
        audioPath: ev.audioPath,
        images: ev.images,
        mode: ev.mode ?? state.mode,
      };
    case 'error':
      return {
        ...state,
        status: 'error',
        error: { message: ev.message, recoverable: ev.recoverable },
      };
  }
}
