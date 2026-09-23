'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entity } from '../src/types/entities.ts';
import type { TraceEvent } from '../src/types/events.ts';
import type { Relationship } from '../src/types/relationships.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import { buildGraphData, entityIdForAddress, eventsForEntity, focusForEvent } from '../lib/graph.ts';
import { followFromEvent, type FollowResult } from '../lib/follow.ts';
import {
  replayEnd,
  replayNext,
  replayPrev,
  replayRestart,
  replaySeek,
  replaySelect,
  replayToggle,
  type ReplayState,
} from '../lib/replay.ts';
import { ContextStrip } from './ContextStrip.tsx';
import { StatusBanner } from './StatusBanner.tsx';
import { Timeline } from './Timeline.tsx';
import { EvidenceInspector } from './EvidenceInspector.tsx';
import { EvidenceGraph } from './EvidenceGraph.tsx';
import { REPLAY_STEP_MS, ReplayBar } from './ReplayBar.tsx';

/**
 * Single interaction state model shared by timeline, inspector, and graph:
 * one `selection` (event | entity | relationship) plus transient UI flags.
 * Every surface derives from it — no competing models.
 */
export type Selection =
  | { kind: 'event'; id: string }
  | { kind: 'entity'; id: string }
  | { kind: 'relationship'; id: string };

export interface FollowTrail {
  fromId: string;
  toId: string;
  entity: string;
}

export function InvestigationView({ contract }: { contract: InvestigationContract }) {
  const inv = contract.investigation;
  const eventsById = useMemo(() => new Map(inv.events.map((e) => [e.id, e])), [inv.events]);
  const entitiesById = useMemo(
    () => new Map<string, Entity>(inv.entities.map((e) => [e.id, e])),
    [inv.entities],
  );
  const relsById = useMemo(
    () => new Map<string, Relationship>(inv.relationships.map((r) => [r.id, r])),
    [inv.relationships],
  );

  const defaultEventId = useMemo(() => {
    const firstPrimary = inv.events.find((e) => e.primary);
    if (firstPrimary) return firstPrimary.id;
    return inv.events.length > 0 ? inv.events[0].id : null;
  }, [inv.events]);

  const [selection, setSelection] = useState<Selection | null>(
    defaultEventId !== null ? { kind: 'event', id: defaultEventId } : null,
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [showCollapsed, setShowCollapsed] = useState(false);
  const [trail, setTrail] = useState<FollowTrail | null>(null);

  // Replay cursor: indexes the contract's event order (never a second model).
  const defaultIndex = defaultEventId !== null
    ? Math.max(0, inv.events.findIndex((e) => e.id === defaultEventId))
    : 0;
  const [replay, setReplay] = useState<ReplayState>({ index: defaultIndex, playing: false });
  const replayRef = useRef(replay);
  replayRef.current = replay;

  /** Apply a replay transition and move selection to the cursor event. */
  const stepReplay = (fn: (events: TraceEvent[], r: ReplayState) => ReplayState) => {
    const next = fn(inv.events, replayRef.current);
    replayRef.current = next;
    setReplay(next);
    const ev = inv.events[next.index];
    if (ev) {
      setSelection({ kind: 'event', id: ev.id });
      setTrail(null);
    }
  };

  // Autoplay: one observed step per interval; stops at the final event.
  useEffect(() => {
    if (!replay.playing || inv.events.length === 0) return;
    if (replay.index >= inv.events.length - 1) {
      setReplay((r) => ({ ...r, playing: false }));
      return;
    }
    const t = setTimeout(() => stepReplay((evs, r) => replayNext(evs, r)), REPLAY_STEP_MS);
    return () => clearTimeout(t);
  }, [replay.playing, replay.index, inv.events]);

  // Manual selection anywhere clears the follow trail, moves the replay
  // cursor to event selections, and pauses (predictable handoff).
  const select = (s: Selection) => {
    setSelection(s);
    setTrail(null);
    if (s.kind === 'event') {
      const next = replaySelect(inv.events, replayRef.current, s.id);
      replayRef.current = next;
      setReplay({ ...next, playing: false });
    } else {
      setReplay((r) => ({ ...r, playing: false }));
    }
  };

  const selectedEvent: TraceEvent | null =
    selection?.kind === 'event' ? (eventsById.get(selection.id) ?? null) : null;
  const selectedEntity: Entity | null =
    selection?.kind === 'entity' ? (entitiesById.get(selection.id) ?? null) : null;
  const selectedRel: Relationship | null =
    selection?.kind === 'relationship' ? (relsById.get(selection.id) ?? null) : null;

  // Graph focus derives from the selection: event → its observed entity,
  // entity → itself, relationship → its source entity.
  const focusAddress: string | null = useMemo(() => {
    if (selectedEvent) return focusForEvent(contract, selectedEvent.id);
    if (selectedEntity) return selectedEntity.address ?? null;
    if (selectedRel) {
      const from = entitiesById.get(selectedRel.fromEntityId);
      return from?.address ?? null;
    }
    return defaultEventId ? focusForEvent(contract, defaultEventId) : null;
  }, [contract, selectedEvent, selectedEntity, selectedRel, entitiesById, defaultEventId]);

  const graphData = useMemo(
    () => buildGraphData(contract, focusAddress ?? ''),
    [contract, focusAddress],
  );
  const focusEntity = focusAddress ? (entitiesById.get(entityIdForAddress(contract, focusAddress) ?? '') ?? null) : null;

  // Timeline highlight set derives from the selection.
  const highlightIds: string[] = useMemo(() => {
    if (selectedEvent) return [selectedEvent.id];
    if (selectedEntity && selectedEntity.address) {
      return eventsForEntity(contract, selectedEntity.address).map((e) => e.id);
    }
    if (selectedRel) return [...selectedRel.evidenceEventIds];
    return [];
  }, [contract, selectedEvent, selectedEntity, selectedRel]);

  // Edges backing the selected event (subtle graph highlight).
  const activeEdgeIds: string[] = selectedEvent ? [...selectedEvent.relationshipIds] : [];

  // Per-edge source pools for the graph connection list.
  const edgeOrigins: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of inv.relationships) {
      const pools = new Set<string>();
      if (r.provenance.kind === 'FACT' || r.provenance.kind === 'RELATION') {
        for (const s of r.provenance.sources) {
          if (s.origin === 'fixture-cache' || s.origin === 'live-nansen') pools.add(s.origin);
        }
      } else {
        pools.add('derived');
      }
      out[r.id] = pools.size > 0 ? [...pools].sort().join(' + ') : 'unavailable';
    }
    return out;
  }, [inv.relationships]);

  // Follow state for the selected event.
  const followResult: FollowResult | null = selectedEvent
    ? followFromEvent(contract, selectedEvent.id)
    : null;

  const onFollow = () => {
    if (followResult?.kind === 'followed') {
      const s = followResult.step;
      setSelection({ kind: 'event', id: s.toEventId });
      setTrail({ fromId: s.fromEventId, toId: s.toEventId, entity: s.entity });
      // Follow pauses replay and moves the cursor via the arrival selection.
      const next = replaySelect(inv.events, replayRef.current, s.toEventId);
      replayRef.current = { ...next, playing: false };
      setReplay(replayRef.current);
    }
  };

  const toggleGroup = (id: string) =>
    setExpandedGroups((prev) => ({ ...prev, [id]: prev[id] !== true }));

  const coverage = contract.coverage.flags;
  const coverageLine = [
    `Funding evidence: ${coverage.fundingEvidence ? 'observed' : 'not observed'}`,
    `Counterparty aggregates: ${coverage.counterpartyAggregates ? 'observed' : 'not observed'}`,
    `Transaction window: ${coverage.transactionWindowCovered ? 'covered' : 'not covered'}`,
  ].join(' · ');

  return (
    <div>
      <ContextStrip contract={contract} />

      <section className="enter enter-3 pt-6 pb-2" aria-label="Incident summary">
        <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground/80">
          INCIDENT · {contract.caseId} · {inv.chain}
        </p>
        <h1 className="mb-2 text-[30px] font-bold leading-tight tracking-tight">{inv.name}</h1>
        <p className="mb-3 max-w-[70ch] text-muted-foreground">{inv.headline}</p>
        <p className="mb-4 font-mono text-[13px] text-muted-foreground">
          window: {inv.window.from} → {inv.window.to} · {inv.events.length} events ·{' '}
          {inv.entities.length} entities
        </p>
        <ul className="mb-2 flex flex-wrap gap-3 p-0" aria-label="Summary metrics from the contract">
          {inv.summary.map((m) => (
            <li
              key={m.key}
              className="theme-surface min-w-[150px] list-none rounded-lg border bg-card px-3.5 py-2.5"
            >
              <div className="mb-0.5 text-xs text-muted-foreground/80">{m.label}</div>
              <div className="font-mono text-[17px] tabular-nums">
                {typeof m.value === 'number'
                  ? m.value.toLocaleString('en-US', { maximumFractionDigits: 4 })
                  : m.value}
                {m.unit ? ` ${m.unit}` : ''}
              </div>
            </li>
          ))}
        </ul>
        <p className="font-mono text-[13px] text-muted-foreground" aria-label="Evidence coverage">
          coverage: {coverageLine}
        </p>
      </section>

      <StatusBanner
        status={inv.status}
        completeness={contract.completeness}
        dataSource={contract.dataSource}
        reasons={contract.completenessReasons}
      />

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section className="enter enter-4" aria-label="Timeline">
          <h2 className="mb-2.5 font-mono text-xs uppercase tracking-wider text-muted-foreground/80">
            TIMELINE — CHRONOLOGICAL, OBSERVED ORDER
          </h2>
          <Timeline
            events={inv.events}
            selectedId={selectedEvent?.id ?? null}
            highlightIds={highlightIds}
            cursorId={inv.events[replay.index]?.id ?? null}
            trail={trail}
            onSelect={(id) => select({ kind: 'event', id })}
            entitiesById={entitiesById}
            eventsById={eventsById}
            expandedGroups={expandedGroups}
            onToggleGroup={toggleGroup}
            showCollapsed={showCollapsed}
            onToggleCollapsed={() => setShowCollapsed((v) => !v)}
          />
          <ReplayBar
            events={inv.events}
            state={replay}
            focusEntity={focusEntity}
            onToggle={() => stepReplay((evs, r) => replayToggle(evs, r))}
            onPrev={() => stepReplay((evs, r) => replayPrev(evs, r))}
            onNext={() => stepReplay((evs, r) => replayNext(evs, r))}
            onRestart={() => stepReplay((evs, r) => replayRestart(evs, r))}
            onEnd={() => stepReplay((evs, r) => replayEnd(evs, r))}
            onSeek={(i) => stepReplay((evs, r) => replaySeek(evs, r, i))}
          />
        </section>
        <div className="enter enter-5 grid content-start gap-5">
          <EvidenceInspector
            selection={selection}
            contract={contract}
            selectedEvent={selectedEvent}
            selectedEntity={selectedEntity}
            selectedRel={selectedRel}
            entitiesById={entitiesById}
            eventsById={eventsById}
            followResult={followResult}
            trail={trail}
            onSelectEvent={(id) => select({ kind: 'event', id })}
            onSelectEntity={(id) => select({ kind: 'entity', id })}
            onSelectRelationship={(id) => select({ kind: 'relationship', id })}
            onFollow={onFollow}
          />
          <EvidenceGraph
            key={focusAddress ?? 'none'}
            data={graphData}
            focusDisplayName={focusEntity?.displayName ?? focusAddress ?? 'none'}
            activeEdgeIds={activeEdgeIds}
            selectedRelationshipId={selectedRel?.id ?? null}
            selectedEntityId={selectedEntity?.id ?? null}
            edgeOrigins={edgeOrigins}
            onSelectNode={(id) => select({ kind: 'entity', id })}
            onSelectEdge={(id) => select({ kind: 'relationship', id })}
          />
        </div>
      </div>

      <section
        className="theme-surface mt-7 rounded-lg border bg-card p-4"
        aria-label="Data gaps and limitations"
      >
        <h2 className="mb-2 text-[15px] font-semibold">Data gaps — what is missing</h2>
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-muted-foreground">
          {inv.dataGaps.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
        <h2 className="mt-4 mb-2 text-[15px] font-semibold">Standing limitations</h2>
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-muted-foreground">
          {contract.evidence.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
