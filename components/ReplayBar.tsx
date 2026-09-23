'use client';

import type { Entity } from '../src/types/entities.ts';
import type { TraceEvent } from '../src/types/events.ts';
import {
  GAP_THRESHOLD_MS,
  formatGap,
  prevGapMs,
  replayKeyAction,
  type ReplayState,
} from '../lib/replay.ts';
import { eventTypeLabel, fmtTime, fmtUsd, shortAddress } from './format.ts';
import { ProvBadge } from './Provenance.tsx';
import { Button } from '@/components/ui/button';

/** Pacing between autoplay steps: slow enough to read each transition. */
export const REPLAY_STEP_MS = 1800;

const COL_TITLE = 'mb-2.5 font-mono text-xs uppercase tracking-wider text-muted-foreground/80';

/**
 * Evidence replay controls + current-evidence readout. An EVENT REPLAY, not a
 * state simulator: stepping only moves selection through observed events (and
 * explicitly marked DERIVED groups). No balances animate; nothing interpolates.
 */
export function ReplayBar({
  events,
  state,
  focusEntity,
  onToggle,
  onPrev,
  onNext,
  onRestart,
  onEnd,
  onSeek,
}: {
  events: TraceEvent[];
  state: ReplayState;
  focusEntity: Entity | null;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
  onEnd: () => void;
  onSeek: (index: number) => void;
}) {
  if (events.length === 0) {
    return (
      <section className="theme-surface mt-5 rounded-lg border bg-card p-3.5" aria-label="Evidence replay">
        <h2 className={COL_TITLE}>EVIDENCE REPLAY</h2>
        <p className="text-muted-foreground" role="status">
          No events to replay.
        </p>
      </section>
    );
  }
  const current = events[Math.min(state.index, events.length - 1)];
  const gap = prevGapMs(events, Math.min(state.index, events.length - 1));
  const value =
    'value' in current && current.value && typeof current.value.valueUsd === 'number'
      ? fmtUsd(current.value.valueUsd)
      : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const action = replayKeyAction(e.key, (e.target as HTMLElement).tagName);
    if (action === null) return;
    e.preventDefault();
    if (action === 'toggle') onToggle();
    else if (action === 'prev') onPrev();
    else if (action === 'next') onNext();
    else if (action === 'restart') onRestart();
    else onEnd();
  };

  return (
    <section
      className="theme-surface mt-5 rounded-lg border bg-card p-3.5"
      aria-label="Evidence replay"
      onKeyDown={onKeyDown}
    >
      <h2 className={COL_TITLE}>EVIDENCE REPLAY — OBSERVED SEQUENCE ONLY</h2>
      <div className="mb-2.5">
        <div className="font-mono text-xs text-muted-foreground" aria-live="off">
          {Math.min(state.index, events.length - 1) + 1} / {events.length} ·{' '}
          <time dateTime={current.timestamp}>{fmtTime(current.timestamp)}</time>
        </div>
        <div className="mt-1 mb-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <ProvBadge kind={current.provenance.kind} /> {eventTypeLabel(current.type)} —{' '}
          {current.title}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {focusEntity
            ? `${focusEntity.displayName} · ${shortAddress(focusEntity.address ?? focusEntity.id)}`
            : 'entity unavailable'}{' '}
          · {value ?? 'USD unavailable'}
        </div>
        {gap !== null && gap >= GAP_THRESHOLD_MS && (
          <p
            className="mt-2 border-l-[3px] pl-2.5 text-[13px] text-muted-foreground"
            style={{ borderLeftColor: 'var(--relation)' }}
            role="note"
          >
            EVIDENCE GAP — {formatGap(gap)} separate this event from the previous observed event.
            Intermediate evidence is not captured.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRestart} aria-label="Restart replay (Home)" title="Home — restart">
          Restart
        </Button>
        <Button variant="outline" size="sm" onClick={onPrev} aria-label="Previous event (Left arrow)" title="ArrowLeft — previous">
          ← Prev
        </Button>
        <Button
          size="sm"
          className="min-w-[86px]"
          onClick={onToggle}
          aria-label={state.playing ? 'Pause replay (Space)' : 'Play replay (Space)'}
          title="Space — play/pause"
        >
          {state.playing ? 'Pause' : 'Play'}
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} aria-label="Next event (Right arrow)" title="ArrowRight — next">
          Next →
        </Button>
        <Button variant="outline" size="sm" onClick={onEnd} aria-label="Final event (End)" title="End — final event">
          End
        </Button>
        <input
          type="range"
          className="replay-scrub mt-1 w-full"
          min={0}
          max={events.length - 1}
          value={Math.min(state.index, events.length - 1)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label={`Replay position, event ${Math.min(state.index, events.length - 1) + 1} of ${events.length}`}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground/80">
        Keys: Space play/pause · ←/→ step · Home restart · End final. Replay pauses at the last
        event and never invents intermediate state.
      </p>
    </section>
  );
}
