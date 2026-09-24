/**
 * TRACE — Reconstruction-stage projection tests.
 *
 * node:test + node:assert, zero new dependencies. Pins the stage semantics:
 * flows are OBSERVED movement events only (never DERIVED groupings), every
 * drawn endpoint is an admitted entity, values render verbatim-or-null (never
 * zero-filled), the reveal/active helpers track the replay cursor exactly, and
 * the whole projection is deterministic across rebuilds and both real cases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStageModel,
  revealedFlows,
  activeFlowAt,
  laneForRole,
  LANE_X,
} from '../lib/stage.ts';
import { buildEulerContract, buildFtxContract } from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';
const MOVEMENT_TYPES = new Set(['funding', 'transfer', 'swap', 'contract-interaction']);

test('S1: every flow is a real observed movement event, never a DERIVED grouping', () => {
  const contract = buildEulerContract(FIXED_AT);
  const inv = contract.investigation;
  const model = buildStageModel(contract);
  assert.ok(model.flows.length > 0, 'Euler produces observed movements');
  for (const f of model.flows) {
    const ev = inv.events.find((e) => e.id === f.eventId);
    assert.ok(ev, `${f.eventId} resolves to a real event`);
    assert.ok(MOVEMENT_TYPES.has(ev.type), `${f.eventId} is a movement type, got ${ev.type}`);
    assert.notEqual(ev.type, 'capital-consolidation');
    assert.notEqual(ev.type, 'capital-dispersal');
    assert.notEqual(ev.type, 'entity-relationship');
    // index is the position in the contract's own event array (cursor space).
    assert.equal(inv.events[f.index].id, f.eventId, `${f.eventId} index maps to its event`);
  }
});

test('S2: flow endpoints and nodes are admitted entities; subject anchors lane 1', () => {
  const contract = buildEulerContract(FIXED_AT);
  const inv = contract.investigation;
  const model = buildStageModel(contract);
  const admitted = new Set(inv.entities.map((e) => e.id));
  for (const f of model.flows) {
    assert.ok(admitted.has(f.fromEntityId), `${f.fromEntityId} is admitted`);
    assert.ok(admitted.has(f.toEntityId), `${f.toEntityId} is admitted`);
    assert.notEqual(f.fromEntityId, f.toEntityId, 'no self-hop drawn');
  }
  for (const n of model.nodes) {
    assert.ok(admitted.has(n.entityId), `${n.entityId} is admitted`);
    assert.equal(n.x, LANE_X[n.lane], 'x derives from lane');
    assert.ok(n.y >= 0 && n.y <= model.height, 'y stays on the stage');
  }
  const subject = inv.entities.find((e) => e.role === 'subject');
  assert.ok(subject, 'Euler has a subject');
  const subjectNode = model.nodes.find((n) => n.entityId === subject.id);
  assert.ok(subjectNode, 'subject is placed on the stage');
  assert.equal(subjectNode.isSubject, true);
  assert.equal(subjectNode.lane, 1, 'subject anchors the center lane');
});

test('S3: flows ascend by cursor index; values are verbatim-or-null, never invented', () => {
  const contract = buildEulerContract(FIXED_AT);
  const inv = contract.investigation;
  const model = buildStageModel(contract);
  for (let i = 1; i < model.flows.length; i++) {
    assert.ok(model.flows[i].index > model.flows[i - 1].index, 'strictly increasing cursor index');
  }
  for (const f of model.flows) {
    const ev = inv.events.find((e) => e.id === f.eventId)!;
    const expectedUsd =
      ev.value && typeof ev.value.valueUsd === 'number' ? ev.value.valueUsd : null;
    assert.equal(f.valueUsd, expectedUsd, `${f.eventId} value is verbatim-or-null`);
    assert.equal(f.tokenSymbol, ev.value?.tokenSymbol ?? null);
    assert.equal(f.provenanceKind, ev.provenance.kind);
    assert.equal(f.eventType, ev.type);
  }
});

test('S4: reveal helpers track the cursor exactly and monotonically', () => {
  const contract = buildEulerContract(FIXED_AT);
  const model = buildStageModel(contract);
  // Nothing revealed before the first observed movement.
  assert.deepEqual(revealedFlows(model, -1), []);
  // Reveal is exactly the prefix at-or-before the cursor, and grows monotonically.
  let prev = 0;
  for (const f of model.flows) {
    const revealed = revealedFlows(model, f.index);
    assert.deepEqual(revealed, model.flows.filter((x) => x.index <= f.index));
    assert.ok(revealed.length >= prev, 'reveal count never decreases');
    prev = revealed.length;
    // The flow whose index is exactly the cursor is the active hop.
    assert.equal(activeFlowAt(model, f.index)?.eventId, f.eventId);
  }
  // Past the end, all flows stand revealed.
  assert.equal(revealedFlows(model, Number.MAX_SAFE_INTEGER).length, model.flows.length);
  // An index that carries no movement (e.g. a DERIVED grouping) has no active hop.
  const flowIdx = new Set(model.flows.map((f) => f.index));
  const gap = contract.investigation.events.findIndex((_, i) => !flowIdx.has(i));
  if (gap !== -1) assert.equal(activeFlowAt(model, gap), null);
});

test('S5: the projection is deterministic across rebuilds', () => {
  const contract = buildEulerContract(FIXED_AT);
  assert.equal(
    JSON.stringify(buildStageModel(contract)),
    JSON.stringify(buildStageModel(contract)),
  );
});

test('S6: generalizes to FTX; lane mapping is a pure role function', () => {
  const contract = buildFtxContract(FIXED_AT);
  const inv = contract.investigation;
  const model = buildStageModel(contract);
  const admitted = new Set(inv.entities.map((e) => e.id));
  for (const f of model.flows) {
    const ev = inv.events.find((e) => e.id === f.eventId)!;
    assert.ok(MOVEMENT_TYPES.has(ev.type), `FTX ${f.eventId} is a movement`);
    assert.ok(admitted.has(f.fromEntityId) && admitted.has(f.toEntityId));
  }
  assert.equal(
    JSON.stringify(buildStageModel(contract)),
    JSON.stringify(buildStageModel(contract)),
  );
  // Origins of value on the left, subject center, destinations right.
  assert.equal(laneForRole('funder'), 0);
  assert.equal(laneForRole('liquidity-source'), 0);
  assert.equal(laneForRole('subject'), 1);
  assert.equal(laneForRole('attacker'), 1);
  assert.equal(laneForRole('whatever-else'), 1);
  assert.equal(laneForRole('counterparty'), 2);
  assert.equal(laneForRole('sink'), 2);
  assert.equal(laneForRole('beneficiary'), 2);
});
