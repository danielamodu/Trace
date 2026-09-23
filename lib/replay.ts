/**
 * TRACE — Evidence replay state model (Phase 3F).
 *
 * Pure, deterministic, contract-only. The cursor indexes the contract's FINAL
 * timeline order — it never invents, duplicates, or reorders events, and it
 * never touches the contract (completeness cannot change; tests pin this).
 *
 * Model:
 *   { index, playing }                      — stored UI state (serializable)
 *   viewOf(events, state) → ReplayView      — derived presentation model:
 *     { cursor, playing, selectedEventId, currentTimestamp, totalEvents }
 *
 * Semantics:
 *  - next/prev move one step and clamp at the ends; next() on the final event
 *    stops playback (playing: false) instead of wrapping or inventing.
 *  - selectEvent moves the cursor to a manually picked event (unknown ids are
 *    ignored, never defaulted).
 *  - Empty investigations: index 0 over zero events; selectedEventId and
 *    currentTimestamp are null; every transition is a no-op.
 *  - Gap detection (prevGapMs): milliseconds between an event and its
 *    predecessor. The UI surfaces gaps above GAP_THRESHOLD_MS as discontinuity
 *    notes — a statement about observed timestamps, never interpolated state.
 *
 * No network, no Nansen, no hypotheses, no animation model. Playback pacing
 * lives in the UI layer (ReplayBar); this module only describes states.
 */

import type { TraceEvent } from '../src/types/events.ts';

export interface ReplayState {
  /** Index into the contract's events array. 0-based; 0 when empty. */
  index: number;
  playing: boolean;
}

export interface ReplayView {
  cursor: number;
  playing: boolean;
  selectedEventId: string | null;
  currentTimestamp: string | null;
  totalEvents: number;
}

/** Gaps at or above this length render as EVIDENCE GAP notes (24 hours). */
export const GAP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function initialReplay(totalEvents: number): ReplayState {
  void totalEvents;
  return { index: 0, playing: false };
}

export function viewOf(events: TraceEvent[], state: ReplayState): ReplayView {
  const current = events[state.index] ?? null;
  return {
    cursor: state.index,
    playing: state.playing && events.length > 0,
    selectedEventId: current ? current.id : null,
    currentTimestamp: current ? current.timestamp : null,
    totalEvents: events.length,
  };
}

function clampIndex(events: TraceEvent[], index: number): number {
  if (events.length === 0) return 0;
  if (index < 0) return 0;
  if (index > events.length - 1) return events.length - 1;
  return index;
}

export function replayNext(events: TraceEvent[], state: ReplayState): ReplayState {
  if (events.length === 0) return { index: 0, playing: false };
  if (state.index >= events.length - 1) return { index: state.index, playing: false };
  return { index: state.index + 1, playing: state.playing };
}

export function replayPrev(events: TraceEvent[], state: ReplayState): ReplayState {
  if (events.length === 0) return { index: 0, playing: false };
  return { index: clampIndex(events, state.index - 1), playing: state.playing };
}

export function replayRestart(events: TraceEvent[], state: ReplayState): ReplayState {
  void events;
  return { index: 0, playing: state.playing };
}

export function replayEnd(events: TraceEvent[], state: ReplayState): ReplayState {
  if (events.length === 0) return { index: 0, playing: false };
  return { index: events.length - 1, playing: state.playing };
}

export function replaySeek(events: TraceEvent[], state: ReplayState, index: number): ReplayState {
  if (!Number.isInteger(index)) return state;
  return { index: clampIndex(events, index), playing: state.playing };
}

/** Manual event selection moves the cursor; unknown ids leave state untouched. */
export function replaySelect(events: TraceEvent[], state: ReplayState, eventId: string): ReplayState {
  const idx = events.findIndex((e) => e.id === eventId);
  if (idx === -1) return state;
  return { index: idx, playing: state.playing };
}

export function replayToggle(events: TraceEvent[], state: ReplayState): ReplayState {
  if (events.length === 0) return { index: 0, playing: false };
  // Toggling play on the final event restarts from the beginning.
  if (!state.playing && state.index >= events.length - 1) {
    return { index: 0, playing: true };
  }
  return { index: state.index, playing: !state.playing };
}

/**
 * Milliseconds between events[index] and its predecessor, or null when there
 * is no predecessor or a timestamp is unparseable (never guessed).
 */
export function prevGapMs(events: TraceEvent[], index: number): number | null {
  if (index <= 0 || index >= events.length) return null;
  const a = Date.parse(events[index - 1].timestamp);
  const b = Date.parse(events[index].timestamp);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

/** Human gap span for discontinuity notes ("15 days", "3 hours", "40 minutes"). */
export function formatGap(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export type ReplayKeyAction = 'toggle' | 'prev' | 'next' | 'restart' | 'end' | null;

/**
 * Keyboard map for the replay region. Space toggles (except on buttons, where
 * native activation already clicks); arrows drive prev/next except inside
 * range inputs (native scrub) — Home/End always restart/finish.
 */
export function replayKeyAction(key: string, targetTag: string): ReplayKeyAction {
  const tag = targetTag.toUpperCase();
  if (key === 'Home') return 'restart';
  if (key === 'End') return 'end';
  if (key === 'ArrowLeft') return tag === 'INPUT' ? null : 'prev';
  if (key === 'ArrowRight') return tag === 'INPUT' ? null : 'next';
  if (key === ' ') return tag === 'BUTTON' || tag === 'A' ? null : 'toggle';
  return null;
}
