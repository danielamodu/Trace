/**
 * TRACE — Phase 3E evidence-graph tests.
 *
 * node:test + node:assert, zero new dependencies. Pins the graph semantics:
 * supported edges only, DERIVED never drawn, deterministic output, empty
 * states, and entity→event coordination helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGraphData,
  entityIdForAddress,
  eventsForEntity,
  focusForEvent,
  prioritizeEdges,
  VISIBLE_EDGE_LIMIT,
} from '../lib/graph.ts';
import { buildEulerContract } from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';
const ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';
const FIRST_FUNDER = '0x036cec1a199234fc02f72d29e596a09440825f1c';

test('G1: subject neighborhood contains only supported relationships', () => {
  const contract = buildEulerContract(FIXED_AT);
  const g = buildGraphData(contract, ATTACKER);
  assert.ok(g.focusEntityId !== null);
  assert.ok(g.edges.length > 0);
  const kinds = new Set(g.edges.map((e) => e.kind));
  for (const k of kinds) {
    assert.ok(
      ['transfer', 'swap', 'funder', 'related-wallet', 'counterparty'].includes(k),
      `supported kind only, got ${k}`,
    );
  }
  assert.ok(!kinds.has('flow'), 'DERIVED flow edges never drawn');
  const funder = g.edges.find((e) => e.kind === 'funder');
  assert.ok(funder, 'funder edge present');
  assert.equal(funder.directed, true);
  // Every edge touches the focus (neighborhood, not a cluster map).
  for (const e of g.edges) {
    assert.ok(e.fromEntityId === g.focusEntityId || e.toEntityId === g.focusEntityId);
  }
  // Deterministic ordering + repeated builds identical.
  assert.equal(JSON.stringify(buildGraphData(contract, ATTACKER)), JSON.stringify(g));
  const ids = g.edges.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('G2: no edge carries DERIVED provenance; counterparty stays undirected', () => {
  const contract = buildEulerContract(FIXED_AT);
  const g = buildGraphData(contract, ATTACKER);
  for (const e of g.edges) {
    const rel = contract.investigation.relationships.find((r) => r.id === e.id)!;
    assert.notEqual(rel.provenance.kind, 'DERIVED', `${e.id} must not be derived`);
    if (e.kind === 'counterparty') assert.equal(e.directed, false);
  }
  const funderNode = g.nodes.find((n) => n.address === FIRST_FUNDER);
  assert.ok(funderNode, 'funder entity is a node');
  assert.equal(funderNode.role, 'funder');
});

test('G3: unknown or isolated focus yields an explicit empty graph', () => {
  const contract = buildEulerContract(FIXED_AT);
  const unknown = buildGraphData(contract, '0xdead00000000000000000000000000000000000000');
  assert.equal(unknown.focusEntityId, null);
  assert.deepEqual(unknown.nodes, []);
  assert.deepEqual(unknown.edges, []);
  assert.deepEqual(eventsForEntity(contract, '0xdead00000000000000000000000000000000000000'), []);
});

test('G4: node selection resolves to the correct investigation context', () => {  const contract = buildEulerContract(FIXED_AT);
  const focus = focusForEvent(contract, 'event_001');
  assert.equal(focus, ATTACKER);
  const involved = eventsForEntity(contract, ATTACKER).map((e) => e.id);
  assert.deepEqual(involved, ['event_001', 'event_002', 'event_003', 'event_004', 'event_005', 'event_006', 'event_009', 'event_010', 'event_011', 'event_013', 'event_014', 'event_015', 'event_017', 'event_018', 'event_019', 'event_021', 'event_022', 'event_023', 'event_024', 'event_025', 'event_027', 'event_028', 'event_030']);
  // Entity ids resolve back for inspector/timeline wiring.
  const funderId = entityIdForAddress(contract, FIRST_FUNDER);
  assert.ok(funderId !== null);
  assert.equal(entityIdForAddress(contract, '0xnope'), null);
});

test('G5: prioritized subset leads with selected/active edges, stays deterministic', () => {
  const contract = buildEulerContract(FIXED_AT);
  const g = buildGraphData(contract, ATTACKER);
  assert.ok(g.edges.length > VISIBLE_EDGE_LIMIT, 'universe larger than the default view');
  const event1 = contract.investigation.events.find((e) => e.id === 'event_001')!;
  const visible = prioritizeEdges(g.edges, event1.relationshipIds, null);
  assert.equal(visible.length, VISIBLE_EDGE_LIMIT);
  // The funder edge backing the selected funding event leads.
  assert.equal(visible[0].kind, 'funder');
  assert.ok(event1.relationshipIds.includes(visible[0].id));
  // Hidden remainder is the complement; nothing invented or dropped.
  const hidden = g.edges.filter((e) => !visible.some((v) => v.id === e.id));
  assert.equal(visible.length + hidden.length, g.edges.length);
  assert.equal(JSON.stringify(prioritizeEdges(g.edges, event1.relationshipIds, null)), JSON.stringify(visible));
  // An explicitly selected edge jumps to front even when collapsed.
  const last = g.edges[g.edges.length - 1];
  const bumped = prioritizeEdges(g.edges, [], last.id);
  assert.equal(bumped[0].id, last.id);
  assert.equal(bumped.length, VISIBLE_EDGE_LIMIT);
});

test('G6: small neighborhoods render whole (no toggle needed)', () => {
  const contract = buildEulerContract(FIXED_AT);
  const g = buildGraphData(contract, FIRST_FUNDER);
  assert.ok(g.edges.length > 0);
  assert.ok(g.edges.length <= VISIBLE_EDGE_LIMIT);
  assert.deepEqual(prioritizeEdges(g.edges, [], null), g.edges);
});
