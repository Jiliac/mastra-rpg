// src/app/play/[slug]/phase-tape.tsx
'use client';

import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { Spinner } from '@/components/ui/spinner';
import { CheckIcon, CircleDashedIcon } from 'lucide-react';
import type { PhaseRecord } from '@/lib/sse/reducer';

const LABELS: Record<PhaseRecord['name'], string> = {
  factions: 'Factions',
  narrator: 'Narrator',
  media: 'Audio + images',
  persist: 'Persisting turn',
};

function PhaseRow({ phase }: { phase: PhaseRecord }) {
  const label =
    phase.name === 'factions' && phase.count !== undefined
      ? `${LABELS.factions} (${phase.count})`
      : LABELS[phase.name];
  return (
    <TaskItem>
      <span className="inline-flex items-center gap-2">
        {phase.status === 'done' ? (
          <CheckIcon className="size-4 text-emerald-500" aria-label="done" />
        ) : phase.status === 'active' ? (
          <Spinner className="size-4" aria-label="in progress" />
        ) : (
          <CircleDashedIcon className="size-4 text-muted-foreground" aria-label="pending" />
        )}
        <span>{label}</span>
      </span>
    </TaskItem>
  );
}

export function PhaseTape({ phases }: { phases: PhaseRecord[] }) {
  if (phases.length === 0) return null;
  return (
    <Task defaultOpen>
      <TaskTrigger title="Turn progress" />
      <TaskContent>
        {phases.map((p) => (
          <PhaseRow key={p.name} phase={p} />
        ))}
      </TaskContent>
    </Task>
  );
}
