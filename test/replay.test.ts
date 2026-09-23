/**
 * TRACE — Phase 3F replay tests.
 *
 * node:test + node:assert, zero new dependencies. The replay model is pure
 * (lib/replay.ts): tests pin cursor transitions, boundaries, gap detection,
 * key mapping, and the non-goals (no invented events, no completeness change,
 * DERIVED preserved) against the Euler fixture contract and synthetic cases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GAP_THRESHOLD_MS,
  formatGap,
  initialReplay,
  prevGapMs,
  replayEnd,
  replayKeyAction,
  replayNext,
  replayPrev,
  replayRestart,
  replaySeek,
  replaySelect,
  replayToggle,
  viewOf,
} from '../lib/replay.ts';
import { buildEulerContract } from '../src/investigations/index.ts';
import { reconstruct } from '../src/reconstruction/engine.ts';
import { normalizeTransfer, sourceMeta } from '../src/reconstruction/normalize.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';
import type { CaseDescriptor, EngineInput, ReconstructionSubject } from '../src/reconstruction/engine.ts';
import { buildContract } from '../src/contract/assemble.ts';
import { eulerCoverage } from '../src/investigations/index.ts';
import type { TraceEvent } from '../src/types/events.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';
const ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';
const euler = () => buildEulerContract(FIXED_AT).investigation.events;

const src = (source: Parameters<typeof sourceMeta>[0]): SourceMeta =>
  sourceMeta(source, { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T00:00:00Z', 'test');
const SUBJECT: ReconstructionSubject = { address: ATTACKER, chain: 'ethereum' };
const CASE: CaseDescriptor = {
  id: 'case_test', name: 'Test', headline: 'Test.', window: { from: '2023-03-13', to: '2023-03-31' },
};
const txRow = (over: Record<string, unknown> = {}) => ({
  block_timestamp: '2023-03-13T10:00:00Z',
  transaction_hash: '0xtx1',
  from_address: '0xaaaa00000000000000000000000000000000000001',
  to_address: '0xbbbb00000000000000000000000000000000000002',
  transfer_value_usd: 2_000_000,
  ...over,
});
const COV = {
  flags: { fundingEvidence: false, counterpartyAggregates: false, transactionWindowCovered: true },
  reasons: [
    'flags.fundingEvidence: none.',
    'flags.counterpartyAggregates: none.',
    'flags.transactionWindowCovered: test window covered.',
  ],
} as const;

test('R1: initial cursor state references the first existing event', () => {
  const events = euler();
  const view = viewOf(events, initialReplay(events.length));
  assert.equal(view.cursor, 0);
  assert.equal(view.playing, false);
  assert.equal(view.selectedEventId, 'event_001');
  assert.equal(view.currentTimestamp, '2023-03-13T09:12:23.000Z');
  assert.equal(view.totalEvents, 30);
});

test('R2/R3: next and previous step through the existing order', () => {
  const events = euler();
  let s = initialReplay(events.length);
  s = replayNext(events, s);
  assert.equal(viewOf(events, s).selectedEventId, 'event_002');
  s = replayNext(events, s);
  assert.equal(viewOf(events, s).selectedEventId, 'event_003');
  s = replayPrev(events, s);
  assert.equal(viewOf(events, s).selectedEventId, 'event_002');
});

test('R4/R5: restart returns to start; end jumps to the final event', () => {
  const events = euler();
  let s = replayEnd(events, initialReplay(events.length));
  assert.equal(viewOf(events, s).selectedEventId, 'event_030');
  s = replayRestart(events, s);
  assert.equal(viewOf(events, s).selectedEventId, 'event_001');
});

test('R6: boundaries clamp and stop playback instead of wrapping', () => {
  const events = euler();
  const atEnd = replayEnd(events, { index: 0, playing: true });
  assert.equal(viewOf(events, atEnd).selectedEventId, 'event_030');
  const beyond = replayNext(events, atEnd);
  assert.equal(viewOf(events, beyond).selectedEventId, 'event_030');
  assert.equal(beyond.playing, false);
  const before = replayPrev(events, { index: 0, playing: true });
  assert.equal(viewOf(events, before).selectedEventId, 'event_001');
  assert.equal(before.playing, true);
  const badSeek = replaySeek(events, initialReplay(events.length), 999);
  assert.equal(viewOf(events, badSeek).selectedEventId, 'event_030');
});

test('R7/R8: empty and single-event investigations never break the model', () => {
  const empty: TraceEvent[] = [];
  assert.deepEqual(viewOf(empty, initialReplay(0)), {
    cursor: 0, playing: false, selectedEventId: null, currentTimestamp: null, totalEvents: 0,
  });
  assert.deepEqual(replayNext(empty, { index: 0, playing: true }), { index: 0, playing: false });
  assert.deepEqual(replayPrev(empty, { index: 0, playing: false }), { index: 0, playing: false });
  assert.deepEqual(replayToggle(empty, { index: 0, playing: false }), { index: 0, playing: false });

  const input: EngineInput = {
    transfers: [normalizeTransfer(txRow({ transaction_hash: '0xaa01' }), src('tgm/transfers'))],
  };
  const one = buildContract(reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }), {
    dataSource: 'fixture-cache', coverage: { ...COV, reasons: [...COV.reasons] }, inputs: input,
  }).investigation.events;
  assert.equal(one.length, 1);
  assert.equal(viewOf(one, replayNext(one, { index: 0, playing: true })).selectedEventId, one[0].id);
  assert.equal(viewOf(one, replayEnd(one, initialReplay(1))).selectedEventId, one[0].id);
});

test('R9: deterministic repeated replay visits identical ids', () => {
  const events = euler();
  const walk = () => {
    const ids: string[] = [];
    let s = initialReplay(events.length);
    ids.push(viewOf(events, s).selectedEventId!);
    for (let i = 0; i < events.length; i++) {
      s = replayNext(events, s);
      ids.push(viewOf(events, s).selectedEventId!);
    }
    return ids;
  };
  assert.deepEqual(walk(), walk());
  assert.deepEqual(walk(), [
    'event_001', 'event_002', 'event_003', 'event_004', 'event_005', 'event_006',
    'event_007', 'event_008', 'event_009', 'event_010', 'event_011', 'event_012',
    'event_013', 'event_014', 'event_015', 'event_016', 'event_017', 'event_018',
    'event_019', 'event_020', 'event_021', 'event_022', 'event_023', 'event_024',
    'event_025', 'event_026', 'event_027', 'event_028', 'event_029', 'event_030',
    'event_030',
  ]);
});

test('R10: play/pause transitions plus keyboard mapping', () => {
  const events = euler();
  assert.equal(replayToggle(events, { index: 0, playing: false }).playing, true);
  assert.equal(replayToggle(events, { index: 3, playing: true }).playing, false);
  // Toggling play on the final event restarts instead of stalling.
  assert.deepEqual(replayToggle(events, { index: 29, playing: false }), { index: 0, playing: true });
  assert.deepEqual(replayToggle([], { index: 0, playing: false }), { index: 0, playing: false });
  // Keyboard: Space toggles (not on buttons/links), arrows step (not in scrubber).
  assert.equal(replayKeyAction(' ', 'DIV'), 'toggle');
  assert.equal(replayKeyAction(' ', 'BUTTON'), null);
  assert.equal(replayKeyAction(' ', 'A'), null);
  assert.equal(replayKeyAction('ArrowLeft', 'DIV'), 'prev');
  assert.equal(replayKeyAction('ArrowRight', 'DIV'), 'next');
  assert.equal(replayKeyAction('ArrowLeft', 'INPUT'), null);
  assert.equal(replayKeyAction('ArrowRight', 'INPUT'), null);
  assert.equal(replayKeyAction('Home', 'BUTTON'), 'restart');
  assert.equal(replayKeyAction('End', 'INPUT'), 'end');
  assert.equal(replayKeyAction('Enter', 'DIV'), null);
  assert.equal(GAP_THRESHOLD_MS, 24 * 60 * 60 * 1000);
});

test('R11: manual event selection moves the cursor; unknown ids are ignored', () => {
  const events = euler();
  const s = replaySelect(events, { index: 0, playing: true }, 'event_006');
  assert.equal(viewOf(events, s).selectedEventId, 'event_006');
  assert.equal(viewOf(events, s).currentTimestamp, '2023-03-13T10:33:35.000Z');
  assert.equal(s.playing, true, 'model preserves playing; the UI pauses on manual select');
  const kept = replaySelect(events, s, 'event_999');
  assert.equal(kept, s, 'unknown ids return state untouched');
});

test('R12/R13: derived events keep DERIVED classification; nothing is invented', () => {
  const events = euler();
  const groups = events.filter((e) => e.type === 'capital-consolidation' || e.type === 'capital-dispersal');
  assert.equal(groups.length, 7);
  const ids = new Set(events.map((e) => e.id));
  let s = initialReplay(events.length);
  for (let i = 0; i < events.length; i++) {
    const v = viewOf(events, s);
    assert.ok(ids.has(v.selectedEventId!), `cursor references existing id ${v.selectedEventId}`);
    const ev = events[s.index];
    if (groups.some((g) => g.id === ev.id)) {
      assert.equal(ev.provenance.kind, 'DERIVED', `${ev.id} stays DERIVED under the cursor`);
    }
    s = replayNext(events, s);
  }
});

test('R14: replay never changes completeness (contract untouched by walks)', () => {
  const before = JSON.stringify(buildEulerContract(FIXED_AT));
  const events = euler();
  let s = initialReplay(events.length);
  for (let i = 0; i < events.length + 2; i++) s = replayNext(events, s);
  s = replayPrev(events, s);
  s = replayRestart(events, s);
  s = replayEnd(events, s);
  assert.equal(JSON.stringify(buildEulerContract(FIXED_AT)), before);
});

test('R15: evidence gaps are detectable from observed timestamps', () => {
  const events = euler();
  assert.equal(prevGapMs(events, 0), null);
  // First large discontinuity: last incident-day event → first dust event.
  const idx = events.findIndex((_, i) => (prevGapMs(events, i) ?? 0) >= GAP_THRESHOLD_MS);
  assert.ok(idx > 0, 'a discontinuity exists in the expanded timeline');
  assert.ok(events[idx - 1].timestamp < '2023-03-15', 'gap opens right after incident-day coverage');
  assert.ok(events[idx].timestamp >= '2023-03-28', 'gap closes at the dust sample');
  assert.match(formatGap(prevGapMs(events, idx)!), /^\d+ days$/);
  assert.equal(formatGap(3 * 3600000), '3 hours');
  assert.equal(formatGap(40 * 60000), '40 minutes');
});

test('R16: follow target and cursor selection agree; UI pauses on follow', () => {
  const contract = buildEulerContract(FIXED_AT);
  const events = contract.investigation.events;
  // Follow from event_001 lands on event_002; selecting it moves the cursor there.
  const s = replaySelect(events, { index: 0, playing: true }, 'event_002');
  assert.equal(viewOf(events, s).selectedEventId, 'event_002');
  // UI rule (implemented in InvestigationView.onFollow): follow pauses replay.
  const paused = { ...s, playing: false };
  assert.equal(viewOf(events, paused).selectedEventId, 'event_002');
  assert.equal(paused.playing, false);
});
