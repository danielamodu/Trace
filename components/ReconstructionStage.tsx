'use client';

import { useMemo } from 'react';
import type { InvestigationContract } from '../src/contract/types.ts';
import {
  buildStageModel,
  revealedFlows,
  activeFlowAt,
  LANE_X,
  type StageNode,
} from '../lib/stage.ts';
import { fmtUsd, provenanceLabel } from './format.ts';

const COL_TITLE = 'font-mono text-xs uppercase tracking-wider text-muted-foreground/80';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Provenance hue for a revealed hop; the active hop overrides to ember. */
function provStroke(kind: string): string {
  if (kind === 'RELATION') return 'var(--relation)';
  if (kind === 'DERIVED') return 'var(--derived)';
  return 'var(--fact)';
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * The reconstruction stage — the cinematic centerpiece. A fixed left→right
 * fund-flow view driven by the SAME replay cursor as the timeline: past hops
 * stay lit, future hops sit as faint ghosts, and the hop at the cursor pulses.
 * Every drawn element is an observed fact from `lib/stage.ts`; nothing between
 * observed points is interpolated (determinism intact).
 */
export function ReconstructionStage({
  contract,
  cursorIndex,
  selectedEntityId,
  selectedEventId,
  onSelectNode,
  onSelectFlow,
}: {
  contract: InvestigationContract;
  cursorIndex: number;
  selectedEntityId: string | null;
  selectedEventId: string | null;
  onSelectNode: (entityId: string) => void;
  onSelectFlow: (eventId: string) => void;
}) {
  const model = useMemo(() => buildStageModel(contract), [contract]);
  const pos = useMemo(
    () => new Map<string, StageNode>(model.nodes.map((n) => [n.entityId, n])),
    [model],
  );
  const revealed = revealedFlows(model, cursorIndex);
  const active = activeFlowAt(model, cursorIndex);
  const nameOf = (id: string) => pos.get(id)?.displayName ?? id;
  const activeNodeIds = new Set(active ? [active.fromEntityId, active.toEntityId] : []);

  if (model.flows.length === 0 || model.nodes.length === 0) {
    return (
      <section aria-label="Reconstruction stage" className="enter enter-3 mt-4">
        <h2 className={`${COL_TITLE} mb-2.5`}>RECONSTRUCTION — OBSERVED FUND FLOW</h2>
        <div className="theme-surface rounded-2xl border bg-card p-6 text-center" role="status">
          <p className="text-muted-foreground">
            No observed value movements in captured evidence for this case. Supporting
            relationships and counterparty aggregates appear below.
          </p>
        </div>
      </section>
    );
  }

  const { width: W, height: H } = model;

  return (
    <section aria-label="Reconstruction stage" className="enter enter-3 mt-4">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={COL_TITLE}>RECONSTRUCTION — OBSERVED FUND FLOW, IN ORDER</h2>
        <p className="font-mono text-xs text-muted-foreground" role="status">
          {revealed.length} / {model.flows.length} observed movements reconstructed
        </p>
      </div>

      <div className="theme-surface hatch overflow-hidden rounded-2xl border bg-card px-2 pt-2 pb-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Observed fund flow for ${contract.investigation.name}: ${revealed.length} of ${model.flows.length} movements revealed at the current replay position.`}
          className="block"
        >
          <title>{`Observed fund flow — ${revealed.length} of ${model.flows.length} movements revealed`}</title>
          <defs>
            <marker id="stage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" style={{ stroke: 'var(--muted-foreground)' }} strokeWidth="1.6" />
            </marker>
            <marker id="stage-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9" fill="none" style={{ stroke: 'var(--primary)' }} strokeWidth="1.9" />
            </marker>
          </defs>

          {model.laneLabels.map((lbl, i) => (
            <text key={lbl} x={LANE_X[i]} y={26} textAnchor="middle" fontSize={10.5}
              style={{ fill: 'var(--muted-foreground)', fontFamily: MONO, letterSpacing: '0.08em' }}>
              {lbl.toUpperCase()}
            </text>
          ))}

          {/* Edges, painter's order: ghosts + revealed first, the active hop on top. */}
          {model.flows.map((f) => {
            const a = pos.get(f.fromEntityId);
            const b = pos.get(f.toEntityId);
            if (!a || !b || active?.eventId === f.eventId) return null;
            const isRevealed = f.index <= cursorIndex;
            const isSel = f.eventId === selectedEventId;
            return (
              <line key={f.eventId} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                style={{ stroke: isRevealed ? provStroke(f.provenanceKind) : 'var(--graph-edge)' }}
                strokeWidth={isSel ? 2.6 : isRevealed ? 1.8 : 1.2}
                strokeOpacity={isRevealed ? 0.9 : 0.14}
                markerEnd={isRevealed ? 'url(#stage-arrow)' : undefined} />
            );
          })}

          {active && pos.get(active.fromEntityId) && pos.get(active.toEntityId) && (
            <g>
              <line x1={pos.get(active.fromEntityId)!.x} y1={pos.get(active.fromEntityId)!.y}
                x2={pos.get(active.toEntityId)!.x} y2={pos.get(active.toEntityId)!.y}
                style={{ stroke: 'var(--primary)' }} strokeWidth={2.6} strokeOpacity={0.55}
                markerEnd="url(#stage-arrow-active)" />
              <line x1={pos.get(active.fromEntityId)!.x} y1={pos.get(active.fromEntityId)!.y}
                x2={pos.get(active.toEntityId)!.x} y2={pos.get(active.toEntityId)!.y}
                className="stage-flow-pulse" />
            </g>
          )}
          {model.nodes.map((n) => {
            const isSel = n.entityId === selectedEntityId;
            const inActive = activeNodeIds.has(n.entityId);
            const r = n.isSubject ? 13 : 9;
            const fill = isSel ? 'var(--primary)' : n.isSubject ? 'var(--foreground)' : 'var(--graph-node)';
            const stroke = n.isSubject ? 'var(--foreground)' : 'var(--muted-foreground)';
            return (
              <g key={n.entityId} tabIndex={0} role="button"
                aria-label={`Focus ${n.displayName}${n.label ? ` (${n.label})` : ''}, role ${n.role}`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelectNode(n.entityId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectNode(n.entityId); }
                }}>
                <title>{`${n.displayName} — ${n.role}${n.label ? ` · ${n.label}` : ''}`}</title>
                {inActive && <circle cx={n.x} cy={n.y} r={r + 4} className="stage-node-pulse" />}
                <circle cx={n.x} cy={n.y} r={r} style={{ fill, stroke }} strokeWidth={n.isSubject ? 2 : 1.5} />
                <text x={n.x} y={n.y + r + 13} textAnchor="middle" fontSize={11}
                  style={{ fill: isSel ? 'var(--primary)' : 'var(--foreground)', fontFamily: MONO }}>
                  {truncate(n.displayName, 18)}
                </text>
                <text x={n.x} y={n.y + r + 25} textAnchor="middle" fontSize={9}
                  style={{ fill: 'var(--muted-foreground)', fontFamily: MONO }}>
                  {n.role}
                </text>
              </g>
            );
          })}

          {active && pos.get(active.fromEntityId) && pos.get(active.toEntityId) && (() => {
            const a = pos.get(active.fromEntityId)!;
            const b = pos.get(active.toEntityId)!;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - 12;
            const label = fmtUsd(active.valueUsd) ?? active.tokenSymbol ?? 'USD n/a';
            const w = Math.max(58, label.length * 7.4);
            return (
              <g pointerEvents="none">
                <rect x={mx - w / 2} y={my - 11} width={w} height={19} rx={9.5} style={{ fill: 'var(--primary)' }} />
                <text x={mx} y={my + 2.5} textAnchor="middle" fontSize={11} fontWeight={600}
                  style={{ fill: 'var(--primary-foreground)', fontFamily: MONO }}>
                  {label}
                </text>
              </g>
            );
          })()}
        </svg>
        <ol className="m-0 mt-1 max-h-44 list-none space-y-1 overflow-auto p-0 pr-1"
          aria-label="Observed movements in order">
          {model.flows.map((f, i) => {
            const isActive = active?.eventId === f.eventId;
            const isRevealed = f.index <= cursorIndex;
            const value = fmtUsd(f.valueUsd);
            return (
              <li key={f.eventId}>
                <button type="button"
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left font-mono text-[11.5px] transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/5'
                      : f.eventId === selectedEventId
                        ? 'border-primary'
                        : 'border-transparent hover:border-border'
                  } ${isRevealed ? '' : 'opacity-45'}`}
                  onClick={() => onSelectFlow(f.eventId)}
                  aria-label={`Select movement ${f.eventId}: ${nameOf(f.fromEntityId)} to ${nameOf(f.toEntityId)}, ${value ?? 'USD unavailable'}, ${provenanceLabel(f.provenanceKind)}`}>
                  <span className="tabular-nums text-muted-foreground/70">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {truncate(nameOf(f.fromEntityId), 16)} <span className="text-muted-foreground">→</span>{' '}
                    {truncate(nameOf(f.toEntityId), 16)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{value ?? '—'}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 px-1 text-xs text-muted-foreground/80">
          Every hop is one observed movement, revealed in the contract&rsquo;s own order — nothing
          between the points is interpolated. Press play on the replay to watch it reconstruct.
        </p>
      </div>
    </section>
  );
}
