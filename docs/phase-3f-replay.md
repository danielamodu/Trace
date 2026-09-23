# TRACE — Phase 3F: Evidence Replay

**Status:** Complete. Replay only — no live capture, AI, replay-of-state simulation, or Phase 3G work.
**Date:** 2026-09-22
**Depends on:** Phases 3A–3E (locked). No contract, type, fixture, engine, or adapter changes were needed or made.
**API calls this phase:** **0** (+0 credits).

---

## 1. Replay state model (`lib/replay.ts`)

Pure, serializable, contract-only. Stored state is `{ index, playing }`; the
presentation model derives from the contract's final timeline order:

```
viewOf(events, state) → { cursor, playing, selectedEventId, currentTimestamp, totalEvents }
```

Transitions (`replayNext/Prev/Restart/End/Seek/Select/Toggle`) return new state;
the cursor only ever indexes existing event ids. `next()` on the final event
stops playback instead of wrapping; out-of-range seeks clamp; unknown select
ids return state untouched; empty investigations yield null selection with
every transition a no-op. Toggling play on the final event restarts from zero.

## 2. Event cursor semantics

- The cursor **is** the timeline position: advancing it selects that event, so
  inspector, graph, context, and cursor marker stay synchronized by construction.
- Manual event selection moves the cursor and pauses (predictable handoff);
  entity/relationship selections pause and leave the cursor in place.
- Follow-money moves the cursor to its arrival event and pauses.
- Autoplay advances one step per 1800ms (`REPLAY_STEP_MS`) — slow enough to
  read each transition — via a timeout chain in `InvestigationView`; SSR emits
  only the paused initial state (hydration-safe).

## 3. Keyboard controls (`replayKeyAction`, tested)

Space play/pause · ArrowLeft/Right step · Home restart · End final. Space is
ignored on buttons/links (native activation already clicks); arrows are ignored
inside the scrubber (native). The mapping is a pure function pinned by tests.

## 4. Synchronization model

One `selection` + replay `{index, playing}` + transient flags (expanded groups,
collapsed toggle, follow trail). Every surface derives from them: timeline
(selected/highlight/cursor/trail marks), inspector (event/entity/relationship
modes + follow section), graph (re-centers on selection, highlights backing
edges), context strip (static counts). No second representation exists.

## 5. Derived-event behavior

Cursor landings on consolidation/dispersal groups render the existing DERIVED
treatment: Derived badge, named calculation, member expansion, and the rule
that groups are never follow targets and never graph edges. Tests assert group
events keep `DERIVED` provenance under the cursor.

## 6. Evidence-gap behavior

`prevGapMs` measures predecessor gaps from observed timestamps; jumps ≥ 24h
render `EVIDENCE GAP — {span} separate this event from the previous observed
event. Intermediate evidence is not captured.` (Euler: 15-day funding→dust
jump flagged; consecutive dust rows quiet.) A discontinuity statement, never
interpolated state. Standing gaps/limitations and the STATUS/COMPLETENESS split
are untouched; replay cannot change completeness (pinned by rebuilding the
contract after full walks and diffing).

## 7. Explicit non-goals

No balance animation, no token-movement animation, no interpolated values, no
causal or intent inference, no autoplay speed controls, no replay-specific
routes, no HYPOTHESIS channel. The replay bar is integrated under the timeline,
not a media-player page.

## 8. Tests

`npm test` — **75/75 pass**: 63 existing + 12 `test/replay.test.ts`
(R1 initial, R2/R3 step, R4/R5 restart/end, R6 boundaries, R7/R8 empty/single,
R9 repeated determinism with exact id list, R10 play/pause + full key map,
R11 manual select, R12/R13 DERIVED + no invention, R14 completeness stability,
R15 gap detection/formatting, R16 follow/cursor agreement). `tsc --noEmit`
clean. `npm run build` succeeds (unchanged route table).

## 9. Manual verification

Live (`next start`, curl): case page (~91KB) contains EVIDENCE REPLAY block,
initial `1 / 8` position, first-event timestamp, Play/Restart/Prev/Next/End,
scrubber with position aria-label, key hints, and the Replay-cursor mark —
alongside all Phase 3D/3E content intact.

Human pass required (no browser automation here):
- [ ] Play full walk → auto-pause at event_008; pause mid-walk; scrub to a group.
- [ ] Keyboard: Space/arrows/Home/End from body, button, and scrubber focus.
- [ ] Follow during replay pauses and lands correctly; dead-end sentence intact.
- [ ] Gap note appears from event_002 onward; DERIVED groups expand under cursor.
- [ ] Zero console errors; focus rings visible; narrow viewport stacks cleanly.

## 10. Files

**Created:** `lib/replay.ts`, `components/ReplayBar.tsx`, `test/replay.test.ts`,
`docs/phase-3f-replay.md`.
**Modified:** `components/InvestigationView.tsx` (replay state, playback effect,
cursor-following selection, follow pauses), `components/Timeline.tsx` (cursor
prop, mark, tag), `app/globals.css` (cursor inset, replay block), `README.md`
(status line).

## 11. Limitations

- Timers live only in the client; SSR is always the paused initial cursor.
- Gap notes use a fixed 24h threshold (documented constant, not evidence).
- `next dev` + browser interaction pass left to the human checklist (§9).

**STOP.** Phase 3G not started.
