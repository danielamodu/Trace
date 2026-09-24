/**
 * TRACE — Nansen-authority projection tests.
 *
 * node:test + node:assert, zero new dependencies. Pins the Pillar ④B narrative:
 * identity resolution never fabricates a name, asserted relationships come only
 * from Nansen relation edges, counterparty totals re-add exactly, the citation
 * surface is a real subset of the Nansen endpoint vocabulary, and the whole
 * projection is deterministic across both real cases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNansenAuthority, labelName } from '../lib/nansen-authority.ts';
import { buildEulerContract, buildFtxContract } from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';

const NANSEN_SOURCES = new Set([
  'profiler/address/counterparties',
  'profiler/address/transactions',
  'profiler/address/related-wallets',
  'tgm/transfers',
  'tgm/dex-trades',
  'tgm/flows',
  'smart-money/netflow',
  'search/general',
]);

test('NA1: identity resolution never invents a name — every named entity holds that label', () => {
  for (const build of [buildEulerContract, buildFtxContract]) {
    const contract = build(FIXED_AT);
    const a = buildNansenAuthority(contract);
    assert.ok(a.entitiesNamed > 0, 'at least one address resolves to a name');
    assert.ok(a.entitiesNamed <= a.entitiesTotal, 'named never exceeds total');
    assert.equal(a.entitiesTotal, contract.investigation.entities.length);
    for (const n of a.namedSamples) {
      const e = contract.investigation.entities.find((x) => x.id === n.entityId);
      assert.ok(e, `${n.entityId} is a real entity`);
      const namesOnEntity = e.labels.map((l) => labelName(l.label)).filter(Boolean);
      assert.ok(namesOnEntity.includes(n.name), `${n.name} is a real label on ${n.entityId}`);
      assert.ok(n.name.trim().length > 0, 'name is non-empty');
    }
  }
});

test('NA2: labelName strips bare hex addresses but keeps real Nansen names', () => {
  assert.equal(labelName('[0x036cec]'), null);
  assert.equal(labelName('0xb66cd966670d962c227b3eaba30a872dbfb995db'), null);
  assert.equal(labelName('UniswapV2 [0x003590]'), 'UniswapV2');
  assert.equal(labelName('motunrayo.eth*'), 'motunrayo.eth*');
  assert.equal(labelName('High Balance'), 'High Balance');
  assert.equal(labelName('pulsechaindotcom.eth* [0x03cf40]'), 'pulsechaindotcom.eth*');
});

test('NA3: asserted relationships come only from Nansen relation edges', () => {
  const euler = buildNansenAuthority(buildEulerContract(FIXED_AT));
  const kinds = new Set(
    buildEulerContract(FIXED_AT).investigation.relationships.map((r) => r.id),
  );
  for (const r of euler.relations) {
    assert.ok(r.nansenRelation.trim().length > 0, 'has a Nansen relation string');
    assert.ok(kinds.has(r.id), 'relation id is a real relationship');
  }
  assert.ok(
    euler.relations.some((r) => r.nansenRelation === 'First Funder'),
    'Euler surfaces the First Funder link',
  );
});

test('NA4: counterparty totals re-add exactly and top list is sorted, capped at 5', () => {
  for (const build of [buildEulerContract, buildFtxContract]) {
    const contract = build(FIXED_AT);
    const a = buildNansenAuthority(contract);
    const cp = contract.investigation.relationships.filter((r) => r.kind === 'counterparty');
    assert.equal(a.counterpartiesTotal, cp.length);
    // Mirror the projection's association order (per-counterparty in+out, then sum).
    const manual = cp
      .map((r) => (r.metrics?.volumeInUsd ?? 0) + (r.metrics?.volumeOutUsd ?? 0))
      .reduce((s, v) => s + v, 0);
    assert.equal(a.totalCounterpartyVolumeUsd, manual);
    assert.ok(a.topCounterparties.length <= 5);
    for (let i = 1; i < a.topCounterparties.length; i++) {
      assert.ok(
        a.topCounterparties[i - 1].volumeUsd >= a.topCounterparties[i].volumeUsd,
        'top counterparties are volume-descending',
      );
    }
  }
});

test('NA5: citation surface is a real subset of the Nansen endpoint vocabulary', () => {
  for (const build of [buildEulerContract, buildFtxContract]) {
    const a = buildNansenAuthority(build(FIXED_AT));
    let sum = 0;
    for (let i = 0; i < a.endpoints.length; i++) {
      assert.ok(NANSEN_SOURCES.has(a.endpoints[i].endpoint), `${a.endpoints[i].endpoint} is a known endpoint`);
      assert.ok(a.endpoints[i].citations > 0);
      if (i > 0) {
        assert.ok(
          a.endpoints[i - 1].citations >= a.endpoints[i].citations,
          'endpoints are citation-descending',
        );
      }
      sum += a.endpoints[i].citations;
    }
    assert.equal(sum, a.citationsTotal, 'endpoint citations re-add to the total');
    for (const o of a.origins) assert.ok(o === 'fixture-cache' || o === 'live-nansen');
  }
});

test('NA6: the projection is deterministic (byte-identical JSON across calls)', () => {
  for (const build of [buildEulerContract, buildFtxContract]) {
    const contract = build(FIXED_AT);
    assert.equal(
      JSON.stringify(buildNansenAuthority(contract)),
      JSON.stringify(buildNansenAuthority(contract)),
    );
  }
});
