/**
 * TRACE — Reconstruction-stage projection (cinematic centerpiece).
 *
 * Pure, deterministic, contract-only. Projects the investigation onto a fixed
 * left→right fund-flow stage: entities placed in lanes by the role the contract
 * ALREADY assigned them, and OBSERVED value movements extracted in the
 * contract's own timeline order. It invents nothing:
 *
 *  - A "flow" is a single observed movement event (funding / transfer / swap /
 *    contract-interaction) whose participants resolve to a distinct from→to
 *    pair. Its value is the event's own valueUsd (or null — never zero-filled).
 *  - DERIVED grouping events (capital-consolidation / capital-dispersal) are
 *    NOT drawn as hops — they are summaries, not movements (mirrors graph.ts).
 *  - Node positions are a deterministic function of role + first appearance;
 *    no physics, no randomness — stable across renders and byte-identical
 *    builds. `index` is the position in the contract's event array, so the
 *    replay cursor drives the stage with no second model.
 *  - The stage never interpolates state between observed points. Advancing the
 *    cursor only REVEALS observed facts in order; motion is presentation.
 */

import type { Entity } from '../src/types/entities.ts';
import type { TraceEvent } from '../src/types/events.ts';
import type { InvestigationContract } from '../src/contract/types.ts';

export interface StageNode {
  entityId: string;
  displayName: string;
  role: string;
  kind: string;
  /** Top Nansen label text, when the entity carries one. */
  label: string | null;
  isSubject: boolean;
  lane: 0 | 1 | 2;
  x: number;
  y: number;
}

export interface StageFlow {
  eventId: string;
  /** Index into the contract's events array == replay cursor space. */
  index: number;
  order: number;
  fromEntityId: string;
  toEntityId: string;
  valueUsd: number | null;
  tokenSymbol: string | null;
  provenanceKind: string;
  eventType: string;
  title: string;
  timestamp: string;
}

export interface StageModel {
  width: number;
  height: number;
  nodes: StageNode[];
  flows: StageFlow[];
  laneLabels: readonly [string, string, string];
}

export const STAGE_W = 960;
export const STAGE_H = 380;
export const LANE_X = [140, STAGE_W / 2, STAGE_W - 140] as const;
const TOP = 66;
/** Vertical space reserved per node, including its two label lines below it. */
const ROW_PITCH = 48;
/** Room under the densest lane's last node for its labels + a bottom margin. */
const BOTTOM_PAD = 58;

const MOVEMENT_TYPES = new Set(['funding', 'transfer', 'swap', 'contract-interaction']);

/** Role → lane. Origins of value on the left, subject center, destinations right. */
export function laneForRole(role: string): 0 | 1 | 2 {
  switch (role) {
    case 'funder':
    case 'liquidity-source':
      return 0;
    case 'counterparty':
    case 'sink':
    case 'beneficiary':
      return 2;
    default:
      return 1; // subject / attacker / anything else anchors the center
  }
}

/** Resolve an event's from→to using the participant side order (never guessed). */
function resolveEnds(ev: TraceEvent): { from: string; to: string } | null {
  const from =
    ev.participants.find((p) => p.side === 'from') ??
    ev.participants.find((p) => p.side === 'actor');
  const to =
    ev.participants.find((p) => p.side === 'to') ??
    ev.participants.find((p) => p.side === 'counterparty');
  if (!from || !to || from.entityId === to.entityId) return null;
  return { from: from.entityId, to: to.entityId };
}

export function buildStageModel(contract: InvestigationContract): StageModel {
  const inv = contract.investigation;
  const byId = new Map<string, Entity>(inv.entities.map((e) => [e.id, e]));

  // 1) Observed movement flows, in the contract's own timeline order.
  const flows: StageFlow[] = [];
  inv.events.forEach((ev, index) => {
    if (!MOVEMENT_TYPES.has(ev.type)) return;
    const ends = resolveEnds(ev);
    if (!ends) return;
    if (!byId.has(ends.from) || !byId.has(ends.to)) return; // never place a phantom
    flows.push({
      eventId: ev.id,
      index,
      order: ev.order,
      fromEntityId: ends.from,
      toEntityId: ends.to,
      valueUsd: ev.value && typeof ev.value.valueUsd === 'number' ? ev.value.valueUsd : null,
      tokenSymbol: ev.value?.tokenSymbol ?? null,
      provenanceKind: ev.provenance.kind,
      eventType: ev.type,
      title: ev.title,
      timestamp: ev.timestamp,
    });
  });

  // 2) Node set = the subject anchor + every entity that appears in a flow.
  const firstSeen = new Map<string, number>();
  for (const f of flows) {
    if (!firstSeen.has(f.fromEntityId)) firstSeen.set(f.fromEntityId, f.index);
    if (!firstSeen.has(f.toEntityId)) firstSeen.set(f.toEntityId, f.index);
  }
  const subject = inv.entities.find((e) => e.role === 'subject') ?? null;
  const nodeIds = new Set<string>(firstSeen.keys());
  if (subject) nodeIds.add(subject.id);

  // 3) Lane assignment + deterministic vertical placement.
  const lanes: string[][] = [[], [], []];
  for (const id of nodeIds) {
    const en = byId.get(id);
    if (en) lanes[laneForRole(en.role)].push(id);
  }
  const seenOf = (id: string) => firstSeen.get(id) ?? Number.MAX_SAFE_INTEGER;
  for (const lane of lanes) {
    lane.sort((a, b) => seenOf(a) - seenOf(b) || (a < b ? -1 : a > b ? 1 : 0));
  }

  // Height grows to fit the densest lane so every real node keeps clear space
  // for its labels — nothing is hidden or summarized (still a pure function of
  // the data). Sparse cases keep the baseline height.
  const maxLane = Math.max(1, lanes[0].length, lanes[1].length, lanes[2].length);
  const usable = (maxLane - 1) * ROW_PITCH;
  const height = Math.max(STAGE_H, TOP + usable + BOTTOM_PAD);
  const midY = TOP + usable / 2;

  const nodes: StageNode[] = [];
  lanes.forEach((lane, laneIdx) => {
    const n = lane.length;
    lane.forEach((id, i) => {
      const en = byId.get(id)!;
      const y = n <= 1 ? midY : TOP + (usable * i) / (n - 1);
      nodes.push({
        entityId: id,
        displayName: en.displayName,
        role: en.role,
        kind: en.kind,
        label: en.labels.length > 0 ? en.labels[0].label : null,
        isSubject: subject !== null && id === subject.id,
        lane: laneIdx as 0 | 1 | 2,
        x: LANE_X[laneIdx],
        y: Math.round(y * 100) / 100,
      });
    });
  });
  nodes.sort((a, b) => a.lane - b.lane || a.y - b.y || (a.entityId < b.entityId ? -1 : 1));

  return {
    width: STAGE_W,
    height,
    nodes,
    flows,
    laneLabels: ['Funders & sources', 'Subject', 'Counterparties & sinks'],
  };
}

/** Flows revealed at a cursor position: those at or before it, in order. */
export function revealedFlows(model: StageModel, cursorIndex: number): StageFlow[] {
  return model.flows.filter((f) => f.index <= cursorIndex);
}

/** The single flow whose event is exactly at the cursor (the active hop), if any. */
export function activeFlowAt(model: StageModel, cursorIndex: number): StageFlow | null {
  return model.flows.find((f) => f.index === cursorIndex) ?? null;
}
