'use client';

import { useState } from 'react';
import type { GraphData } from '../lib/graph.ts';
import { prioritizeEdges, VISIBLE_EDGE_LIMIT } from '../lib/graph.ts';
import { shortAddress } from './format.ts';

const COL_TITLE = 'mb-2.5 font-mono text-xs uppercase tracking-wider text-muted-foreground/80';

function kindLabel(kind: string): string {
  switch (kind) {
    case 'transfer': return 'Transfer';
    case 'swap': return 'Swap';
    case 'funder': return 'Funder (reported)';
    case 'related-wallet': return 'Related wallet (reported)';
    case 'counterparty': return 'Counterparty aggregate';
    default: return kind;
  }
}

/**
 * Compact supporting relationship view for the focused entity. SVG radial map
 * plus an equivalent textual connection list (the accessible path — every node
 * and edge is also a keyboard-operable button). Supported edges only; DERIVED
 * summaries are never drawn. SVG hues bind to theme tokens via inline style.
 */
export function EvidenceGraph({
  data,
  focusDisplayName,
  activeEdgeIds,
  selectedRelationshipId,
  selectedEntityId,
  edgeOrigins,
  onSelectNode,
  onSelectEdge,
}: {
  data: GraphData;
  focusDisplayName: string;
  /** Edge ids backing the selected event (subtle highlight). */
  activeEdgeIds: string[];
  selectedRelationshipId: string | null;
  selectedEntityId: string | null;
  /** Precomputed per-edge source pool (fixture-cache / live-nansen). */
  edgeOrigins: Record<string, string>;
  onSelectNode: (entityId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Parent remounts on focus change (key), so collapsed-by-default resets
  // whenever the investigation context moves.
  const visibleEdges = showAll
    ? data.edges
    : prioritizeEdges(data.edges, activeEdgeIds, selectedRelationshipId, VISIBLE_EDGE_LIMIT);
  const visibleNodes = data.nodes.filter(
    (n) => n.isFocus || visibleEdges.some((e) => e.fromEntityId === n.entityId || e.toEntityId === n.entityId),
  );
  if (data.focusEntityId === null || data.nodes.length === 0) {
    return (
      <section aria-label="Relationship graph">
        <h2 className={COL_TITLE}>RELATIONSHIPS — SUPPORTING</h2>
        <div className="theme-surface rounded-lg border bg-card p-5 text-center" role="status">
          <p className="text-muted-foreground">
            No directly observed relationships for this entity in captured evidence.
          </p>
        </div>
      </section>
    );
  }

  const W = 340;
  const H = 250;
  const CX = W / 2;
  const CY = 112;
  const RX = 128;
  const RY = 82;
  const neighbors = visibleNodes.filter((n) => !n.isFocus);
  const pos = new Map<string, { x: number; y: number }>([[data.focusEntityId, { x: CX, y: CY }]]);
  neighbors.forEach((n, i) => {
    const a = (-90 + (i * 360) / Math.max(neighbors.length, 1)) * (Math.PI / 180);
    pos.set(n.entityId, { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) });
  });
  const byId = new Map(data.nodes.map((n) => [n.entityId, n]));
  const activate = (e: React.SVGAttributes<SVGGElement>, id: string, kind: 'node' | 'edge') => ({
    ...e,
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': id,
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (kind === 'node') onSelectNode(id);
        else onSelectEdge(id);
      }
    },
  });
  return (
    <section aria-label="Relationship graph">
      <h2 className={COL_TITLE}>RELATIONSHIPS — SUPPORTING</h2>
      <div className="theme-surface rounded-lg border bg-card px-3 pt-2.5 pb-3">
        <p className="mb-2 font-mono text-xs text-muted-foreground" role="status">
          {visibleEdges.length} of {data.edges.length} observed connections
          {selectedRelationshipId ? ' · selected edge always shown' : ''}
        </p>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Observed relationships of ${focusDisplayName}: showing ${visibleEdges.length} of ${data.edges.length} edges`}
          className="block"
        >
          <title>{`Observed relationships of ${focusDisplayName}`}</title>
          <defs>
            <marker id="t3e-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" style={{ stroke: 'var(--muted-foreground)' }} strokeWidth="1.6" />
            </marker>
            <marker id="t3e-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" style={{ stroke: 'var(--primary)' }} strokeWidth="1.8" />
            </marker>
          </defs>
          {visibleEdges.map((e) => {
            const a = pos.get(e.fromEntityId)!;
            const b = pos.get(e.toEntityId)!;
            const isSel = e.id === selectedRelationshipId;
            const isActive = activeEdgeIds.includes(e.id);
            const stroke = isSel
              ? 'var(--primary)'
              : isActive
                ? 'var(--muted-foreground)'
                : 'var(--graph-edge)';
            return (
              <g
                key={e.id}
                {...activate({ onClick: () => onSelectEdge(e.id), style: { cursor: 'pointer' } }, e.id, 'edge')}
              >
                <title>{`${kindLabel(e.kind)}: ${byId.get(e.fromEntityId)?.displayName ?? e.fromEntityId} ${e.directed ? '→' : '—'} ${byId.get(e.toEntityId)?.displayName ?? e.toEntityId} (${e.evidenceCount} evidence, source: ${edgeOrigins[e.id] ?? 'unavailable'})`}</title>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  style={{ stroke }}
                  strokeWidth={isSel ? 2.4 : 1.4}
                  strokeDasharray={e.kind === 'counterparty' ? '5 3' : undefined}
                  markerEnd={e.directed ? `url(#${isSel ? 't3e-arrow-hi' : 't3e-arrow'})` : undefined}
                />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} />
              </g>
            );
          })}
          {visibleNodes.map((n) => {
            const p = pos.get(n.entityId)!;
            const isSel = n.entityId === selectedEntityId;
            const fill = isSel ? 'var(--primary)' : n.isFocus ? 'var(--foreground)' : 'var(--graph-node)';
            const stroke = n.isFocus ? 'var(--foreground)' : 'var(--muted-foreground)';
            return (
              <g
                key={n.entityId}
                {...activate({ onClick: () => onSelectNode(n.entityId), style: { cursor: 'pointer' } }, n.entityId, 'node')}
              >
                <title>{`${n.displayName} (${n.role})${n.isFocus ? ' — focus' : ''}`}</title>
                <circle
                  cx={p.x} cy={p.y}
                  r={n.isFocus ? 10 : 8}
                  style={{ fill, stroke }}
                  strokeWidth={n.isFocus ? 2 : 1.5}
                />
                <text
                  x={p.x} y={p.y + (n.isFocus ? 22 : 19)}
                  textAnchor="middle"
                  fontSize={9}
                  style={{ fill: isSel ? 'var(--primary)' : 'var(--muted-foreground)' }}
                  fontFamily="ui-monospace, monospace"
                >
                  {n.displayName.length > 14 ? `${n.displayName.slice(0, 13)}…` : n.displayName}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="m-0 mt-2 list-none space-y-1 p-0" aria-label="Observed connections">
          {visibleEdges.map((e) => {
            const otherId = e.fromEntityId === data.focusEntityId ? e.toEntityId : e.fromEntityId;
            const other = byId.get(otherId);
            const dir = !e.directed ? '—' : e.fromEntityId === data.focusEntityId ? '→' : '←';
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={`block w-full cursor-pointer rounded-md border bg-background px-2.5 py-1.5 text-left text-xs hover:border-primary ${e.id === selectedRelationshipId ? 'border-primary' : ''}`}
                  onClick={() => onSelectEdge(e.id)}
                  aria-label={`Select relationship ${e.id}: ${kindLabel(e.kind)} ${dir} ${other?.displayName ?? otherId}`}
                >
                  <span className="font-mono">{dir}</span> {other?.displayName ?? shortAddress(otherId)} ·{' '}
                  {kindLabel(e.kind)}
                  {e.nansenRelation ? ` (“${e.nansenRelation}”)` : ''} · {e.evidenceCount} evidence ·{' '}
                  <span className="font-mono text-[11px]">{edgeOrigins[e.id] ?? 'unavailable'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {data.edges.length > visibleEdges.length && (
          <p className="mt-2">
            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border border-dashed bg-transparent px-3 py-2 text-[13px] text-muted-foreground hover:border-primary hover:text-foreground"
              onClick={() => setShowAll(true)}
              aria-expanded={false}
              aria-label={`View all ${data.edges.length} observed relationships`}
            >
              View all {data.edges.length} relationships
            </button>
          </p>
        )}
        {showAll && (
          <p className="mt-2">
            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border border-dashed bg-transparent px-3 py-2 text-[13px] text-muted-foreground hover:border-primary hover:text-foreground"
              onClick={() => setShowAll(false)}
              aria-expanded={true}
              aria-label="Show fewer relationships"
            >
              Show fewer
            </button>
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground/80">
          Observed relationships only — derived summaries excluded.
        </p>
      </div>
    </section>
  );
}
