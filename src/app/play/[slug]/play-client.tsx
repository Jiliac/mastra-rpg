// src/app/play/[slug]/play-client.tsx
//
// The chat UI for one campaign. Posts turns to /api/turn, reads the SSE
// stream, folds events into a reducer, and renders:
//   - left column: conversation (user input + streaming narrator prose,
//     then audio + images at `done`)
//   - right column: phase tape

'use client';

import { useCallback, useReducer, useRef, useState } from 'react';
import { initialState, reducePhaseEvent, type UiState } from '@/lib/sse/reducer';
import { parseSseChunks } from '@/lib/sse/parse';
import type { PhaseEvent } from '@/lib/sse/events';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerTimeDisplay,
  AudioPlayerTimeRange,
  AudioPlayerVolumeRange,
} from '@/components/ai-elements/audio-player';
import { PhaseTape } from './phase-tape';
import { TurnImages } from './turn-images';
import { MutexBanner } from './mutex-banner';

interface TurnRecord {
  id: string;
  userInput: string;
  state: UiState;
}

type Action =
  | { type: 'new-turn'; id: string; userInput: string }
  | { type: 'event'; id: string; ev: PhaseEvent };

function reduceTurns(turns: TurnRecord[], action: Action): TurnRecord[] {
  switch (action.type) {
    case 'new-turn':
      return [...turns, { id: action.id, userInput: action.userInput, state: initialState() }];
    case 'event':
      return turns.map((t) =>
        t.id === action.id ? { ...t, state: reducePhaseEvent(t.state, action.ev) } : t,
      );
  }
}

export function PlayClient({ slug }: { slug: string }) {
  const [turns, dispatch] = useReducer(reduceTurns, []);
  const [busy, setBusy] = useState(false);
  const [mutexMessage, setMutexMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '' || busy) return;

      const id = `turn-${Date.now()}`;
      setBusy(true);
      setMutexMessage(null);
      dispatch({ type: 'new-turn', id, userInput: trimmed });

      let res: Response;
      try {
        res = await fetch('/api/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug, input: trimmed }),
        });
      } catch (err) {
        dispatch({
          type: 'event',
          id,
          ev: {
            type: 'error',
            message: err instanceof Error ? err.message : 'network error',
            recoverable: true,
          },
        });
        setBusy(false);
        return;
      }

      if (!res.ok || res.body === null) {
        dispatch({
          type: 'event',
          id,
          ev: {
            type: 'error',
            message: `server returned ${res.status}`,
            recoverable: true,
          },
        });
        setBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseChunks(buf);
          buf = rest;
          for (const ev of events) {
            dispatch({ type: 'event', id, ev });
            if (ev.type === 'error' && ev.recoverable && ev.message === 'still working') {
              setMutexMessage(
                'A turn is already running for this campaign. Try again once it completes.',
              );
            }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, slug],
  );

  return (
    <div className="mx-auto flex h-screen w-full max-w-7xl flex-col gap-4 p-4 lg:flex-row">
      <div className="flex flex-1 flex-col">
        <h1 className="mb-2 font-semibold text-2xl">{slug}</h1>
        <MutexBanner visible={mutexMessage !== null} message={mutexMessage ?? ''} />
        <Conversation>
          <ConversationContent>
            {turns.length === 0 && (
              <ConversationEmptyState
                title="Begin the session"
                description="Describe what your character does next."
              />
            )}
            {turns.map((t) => (
              <TurnView key={t.id} slug={slug} turn={t} />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <PromptInput
          onSubmit={async (msg) => {
            const text = msg.text ?? '';
            await submit(text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              ref={inputRef}
              placeholder="What do you do?"
              disabled={busy || mutexMessage !== null}
            />
            <PromptInputFooter>
              <span />
              <PromptInputSubmit
                disabled={busy || mutexMessage !== null}
                status={busy ? 'streaming' : 'ready'}
              />
            </PromptInputFooter>
          </PromptInputBody>
        </PromptInput>
      </div>
      <aside className="w-full shrink-0 lg:w-80">
        {turns.length > 0 && <PhaseTape phases={turns[turns.length - 1].state.phases} />}
      </aside>
    </div>
  );
}

function TurnView({ slug, turn }: { slug: string; turn: TurnRecord }) {
  const { state } = turn;
  const proseToRender = state.finalProse ?? state.prose;
  return (
    <div className="flex flex-col gap-3">
      <Message from="user">
        <MessageContent>
          <span>{turn.userInput}</span>
        </MessageContent>
      </Message>
      {(state.status !== 'idle' || proseToRender.length > 0) && (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>{proseToRender}</MessageResponse>
          </MessageContent>
        </Message>
      )}
      {state.error && (
        <Message from="assistant">
          <MessageContent>
            <span className="text-destructive text-sm">
              Error: {state.error.message}
              {state.error.recoverable ? '' : ' (not recoverable)'}
            </span>
          </MessageContent>
        </Message>
      )}
      {state.status === 'done' && state.audioPath && (
        <AudioPlayer className="mt-2">
          <AudioPlayerElement
            src={`/api/turn/audio?slug=${encodeURIComponent(slug)}&filename=${encodeURIComponent(basename(state.audioPath))}`}
          />
          <AudioPlayerControlBar>
            <AudioPlayerPlayButton />
            <AudioPlayerTimeDisplay />
            <AudioPlayerTimeRange />
            <AudioPlayerDurationDisplay />
            <AudioPlayerMuteButton />
            <AudioPlayerVolumeRange />
          </AudioPlayerControlBar>
        </AudioPlayer>
      )}
      {state.status === 'done' && state.images.length > 0 && (
        <TurnImages slug={slug} images={state.images} />
      )}
    </div>
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
