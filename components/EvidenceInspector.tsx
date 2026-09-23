import type { ReactNode } from 'react';
import type { Entity } from '../src/types/entities.ts';
import type { TraceEvent } from '../src/types/events.ts';
import type { Relationship } from '../src/types/relationships.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import { eventsForEntity } from '../lib/graph.ts';
import { eventOrigin, originLabel } from '../lib/sources.ts';
import { FOLLOW_DEAD_END, type FollowResult } from '../lib/follow.ts';
import type { FollowTrail, Selection } from './InvestigationView.tsx';
import { eventTypeLabel, explorerTxUrl, fmtTime, fmtUsd, shortAddress } from './format.ts';
import { ProvBadge } from './Provenance.tsx';
import { Button } from '@/components/ui/button';

const ROW = 'my-2';
const K = 'mb-1 text-[11.5px] uppercase tracking-widest text-muted-foreground/80';
const V = 'text-[13.5px]';
const MONO = 'font-mono text-xs tabular-nums';
const CHIP =
  'mr-1.5 mb-1.5 inline-block cursor-pointer rounded-md border bg-background px-2.5 py-1.5 text-left text-[12.5px] hover:border-primary';

/** Inspector shell with a provenance-tinted left edge (one hue per kind). */
function Aside({ kind, label, children }: { kind?: string; label: string; children: ReactNode }) {
  const border =
    kind === 'FACT'
      ? 'var(--fact-border)'
      : kind === 'RELATION'
        ? 'var(--relation)'
        : kind === 'DERIVED'
          ? 'var(--derived)'
          : undefined;
  return (
    <aside
      className={`theme-surface rounded-lg border bg-card p-3.5 lg:sticky lg:top-[70px] ${border ? 'border-l-[3px]' : ''}`}
      style={border ? { borderLeftColor: border } : undefined}
      aria-label={label}
    >
      {children}
    </aside>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">{children}</h2>;
}

function EntityChips({
  event,
  entitiesById,
  onSelectEntity,
}: {
  event: TraceEvent;
  entitiesById: Map<string, Entity>;
  onSelectEntity: (id: string) => void;
}) {
  return (
    <>
      {event.participants.map((p, i) => {
        const en = entitiesById.get(p.entityId);
        return (
          <button
            key={i}
            type="button"
            className={CHIP}
            onClick={() => onSelectEntity(p.entityId)}
            aria-label={`Inspect entity ${en?.displayName ?? p.entityId}`}
          >
            {en?.displayName ?? shortAddress(en?.address ?? p.entityId)}{' '}
            <span className="font-mono text-muted-foreground">
              {en?.address ? shortAddress(en.address) : p.entityId}
            </span>{' '}
            <span className="font-mono text-[11px] text-muted-foreground/80">
              {p.side}
              {en ? ` · ${en.role}` : ''}
            </span>
          </button>
        );
      })}
    </>
  );
}

function relOriginLabel(r: Relationship): string {
  const origins = new Set<string>();
  if (r.provenance.kind === 'FACT' || r.provenance.kind === 'RELATION') {
    for (const s of r.provenance.sources) {
      if (s.origin === 'fixture-cache' || s.origin === 'live-nansen') origins.add(s.origin);
    }
  } else if (r.provenance.kind === 'DERIVED') {
    return 'mixed or derived — see member events';
  }
  if (origins.size === 0) return 'unavailable';
  return [...origins].sort().join(' + ');
}

function SourcesList({
  sources,
}: {
  sources: Array<{ source: string; capturedAt: string; requestId?: string }>;
}) {
  return (
    <ul className="mt-1.5 list-none text-xs">
      {sources.map((s, i) => (
        <li key={i} className="border-t py-1.5 font-mono text-xs text-muted-foreground">
          endpoint: {s.source}
          <br />
          captured: {s.capturedAt}
          {s.requestId && (
            <>
              <br />
              request: {s.requestId}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
/**
 * Evidence Inspector: renders the current selection — an event, an entity, or
 * a relationship — with follow controls for followable events. Everything
 * shown comes from the contract; absences render as absences.
 */
export function EvidenceInspector({
  selection,
  contract,
  selectedEvent,
  selectedEntity,
  selectedRel,
  entitiesById,
  eventsById,
  followResult,
  trail,
  onSelectEvent,
  onSelectEntity,
  onSelectRelationship,
  onFollow,
}: {
  selection: Selection | null;
  contract: InvestigationContract;
  selectedEvent: TraceEvent | null;
  selectedEntity: Entity | null;
  selectedRel: Relationship | null;
  entitiesById: Map<string, Entity>;
  eventsById: Map<string, TraceEvent>;
  followResult: FollowResult | null;
  trail: FollowTrail | null;
  onSelectEvent: (id: string) => void;
  onSelectEntity: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onFollow: () => void;
}) {
  if (selection === null) {
    return (
      <Aside label="Evidence inspector">
        <H2>EVIDENCE INSPECTOR</H2>
        <p className="text-muted-foreground">
          Select an event in the timeline to inspect its evidence.
        </p>
      </Aside>
    );
  }

  if (selection.kind === 'entity' && selectedEntity) {
    const en = selectedEntity;
    const involvedRels = contract.investigation.relationships.filter(
      (r) => r.fromEntityId === en.id || r.toEntityId === en.id,
    );
    const observed = en.address ? eventsForEntity(contract, en.address).length : 0;
    return (
      <Aside kind={en.provenance.kind} label={`Entity ${en.displayName}`}>
        <H2>EVIDENCE INSPECTOR · ENTITY</H2>
        <div className={ROW}>
          <div className={K}>Entity</div>
          <div className={V}>
            {en.displayName} <ProvBadge kind={en.provenance.kind} />
          </div>
          {en.address && <div className={`${V} ${MONO} break-all`}>{en.address}</div>}
        </div>
        <div className={ROW}>
          <div className={K}>Role / admission</div>
          <div className="font-mono text-xs">{en.role} · {en.admissionReason}</div>
        </div>
        {en.labels.length > 0 && (
          <div className={ROW}>
            <div className={K}>Labels (Nansen)</div>
            <div className={V}>{en.labels.map((l) => l.label).join(' · ')}</div>
          </div>
        )}
        <div className={ROW}>
          <div className={K}>Observed relationships ({involvedRels.length})</div>
          <div className={V}>
            {involvedRels.map((r) => (
              <button
                key={r.id}
                type="button"
                className={CHIP}
                onClick={() => onSelectRelationship(r.id)}
                aria-label={`Inspect relationship ${r.id}`}
              >
                <span className="font-mono">{r.id}</span> · {r.kind}
                {r.directed ? ' →' : ' —'}
              </button>
            ))}
          </div>
        </div>
        <div className={ROW}>
          <div className={K}>Observed events involving</div>
          <div className={`${V} ${MONO}`}>{observed} (highlighted on the timeline)</div>
        </div>
      </Aside>
    );
  }
  if (selection.kind === 'relationship' && selectedRel) {
    const r = selectedRel;
    const from = entitiesById.get(r.fromEntityId);
    const to = entitiesById.get(r.toEntityId);
    const fromName = from?.displayName ?? shortAddress(from?.address ?? r.fromEntityId);
    const toName = to?.displayName ?? shortAddress(to?.address ?? r.toEntityId);
    return (
      <Aside kind={r.provenance.kind} label={`Relationship ${r.id}`}>
        <H2>
          EVIDENCE INSPECTOR · <span className="font-mono normal-case">{r.id}</span>
        </H2>
        <div className={ROW}>
          <div className={K}>Classification</div>
          <div className={V}>
            <ProvBadge kind={r.provenance.kind} /> {r.kind}
          </div>
          <div className="font-mono text-xs text-muted-foreground">Source: {relOriginLabel(r)}</div>
        </div>
        <div className={ROW}>
          <div className={K}>Direction</div>
          <div className={V}>
            {fromName} {r.directed ? '→' : '—'} {toName}
          </div>
          {r.nansenRelation && (
            <div className={`${V} text-muted-foreground`}>
              Nansen reports: “{r.nansenRelation}” — a reported link, not proof of common control.
            </div>
          )}
          {!r.directed && (
            <div className={`${V} text-muted-foreground`}>
              Undirected window aggregate — direction is not evidenced.
            </div>
          )}
        </div>
        <div className={ROW}>
          <div className={K}>Metrics</div>
          <div className="font-mono text-[12.5px]">
            {r.metrics?.interactionCount !== undefined && <div>interactions: {r.metrics.interactionCount}</div>}
            {r.metrics?.volumeInUsd !== undefined && <div>in: {fmtUsd(r.metrics.volumeInUsd)}</div>}
            {r.metrics?.volumeOutUsd !== undefined && <div>out: {fmtUsd(r.metrics.volumeOutUsd)}</div>}
            {r.metrics?.netFlowUsd !== undefined && <div>net (derived): {fmtUsd(r.metrics.netFlowUsd)}</div>}
            {r.metrics === undefined && (
              <span className="text-muted-foreground/80">No aggregate metrics — see evidence events.</span>
            )}
          </div>
        </div>
        <div className={ROW}>
          <div className={K}>Evidence events ({r.evidenceEventIds.length})</div>
          <div className={V}>
            {r.evidenceEventIds.length === 0 && (
              <span className="text-muted-foreground/80">
                Window aggregate — no per-transaction evidence in inputs.
              </span>
            )}
            {r.evidenceEventIds.map((id) => (
              <button
                key={id}
                type="button"
                className={CHIP}
                onClick={() => onSelectEvent(id)}
                aria-label={`Inspect event ${id}`}
              >
                <span className="font-mono">{id}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={ROW}>
          <div className={K}>Provenance</div>
          <div className="border-l-2 pl-2.5 text-[13px] text-muted-foreground">
            {(r.provenance.kind === 'FACT' || r.provenance.kind === 'RELATION') && r.provenance.statement}
            {r.provenance.kind === 'DERIVED' && (
              <>Computed {r.provenance.calculation} — a derived summary, not an observed transaction.</>
            )}
          </div>
          {(r.provenance.kind === 'FACT' || r.provenance.kind === 'RELATION') && (
            <SourcesList sources={r.provenance.sources} />
          )}
        </div>
      </Aside>
    );
  }

  if (!selectedEvent) {
    return (
      <Aside label="Evidence inspector">
        <H2>EVIDENCE INSPECTOR</H2>
        <p className="text-muted-foreground">
          That selection no longer resolves. Pick an event, entity, or relationship.
        </p>
      </Aside>
    );
  }
  const event = selectedEvent;
  const group = event.type === 'capital-consolidation' || event.type === 'capital-dispersal';
  const members =
    event.provenance.kind === 'DERIVED'
      ? event.provenance.sourceEventIds
          .map((id) => eventsById.get(id))
          .filter((m): m is TraceEvent => m !== undefined)
      : [];
  const value =
    'value' in event && event.value && typeof event.value.valueUsd === 'number'
      ? fmtUsd(event.value.valueUsd)
      : null;
  const origin = eventOrigin(contract, event.id);
  return (
    <Aside kind={event.provenance.kind} label={`Evidence for ${event.id}`}>
      <H2>
        EVIDENCE INSPECTOR · <span className="font-mono normal-case">{event.id}</span>
      </H2>

      {trail && trail.toId === event.id && (
        <div className={ROW}>
          <div className="text-[13px] text-primary">
            Followed {shortAddress(trail.entity)} from{' '}
            <span className="font-mono">{trail.fromId}</span>.{' '}
            <button
              type="button"
              className="cursor-pointer text-primary underline underline-offset-2"
              onClick={() => onSelectEvent(trail.fromId)}
            >
              Back to {trail.fromId}
            </button>
          </div>
        </div>
      )}

      <div className={ROW}>
        <div className={K}>Classification</div>
        <div className={V}>
          <ProvBadge kind={event.provenance.kind} /> {eventTypeLabel(event.type)}
        </div>
        <div className="mt-1 text-xs">
          <span className="inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            source: {origin}
          </span>{' '}
          <span className="text-muted-foreground">{originLabel(origin)}</span>
        </div>
      </div>

      <div className={ROW}>
        <div className={K}>Timestamp</div>
        <div className={MONO}>
          <time dateTime={event.timestamp}>{fmtTime(event.timestamp)}</time>
        </div>
      </div>

      {event.txHash && (
        <div className={ROW}>
          <div className={K}>Transaction</div>
          <div className={`${MONO} break-all`}>{event.txHash}</div>
          <div className="mt-1 text-[13.5px]">
            <a
              className="text-primary underline underline-offset-2"
              href={explorerTxUrl(event.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              View on explorer
            </a>
          </div>
        </div>
      )}

      {event.method && (
        <div className={ROW}>
          <div className={K}>Method</div>
          <div className={MONO}>{event.method}</div>
        </div>
      )}

      <div className={ROW}>
        <div className={K}>Value</div>
        <div className={MONO}>{value ?? 'USD unavailable — not estimated'}</div>
      </div>

      <div className={ROW}>
        <div className={K}>Entities involved</div>
        <div className={V}>
          <EntityChips event={event} entitiesById={entitiesById} onSelectEntity={onSelectEntity} />
        </div>
      </div>
      {!group && (
        <div className={ROW}>
          <div className={K}>Follow the money</div>
          {followResult?.kind === 'followed' ? (
            <div className={V}>
              <Button
                variant="outline"
                size="sm"
                onClick={onFollow}
                aria-label={`Follow ${shortAddress(followResult.step.entity)} to next observed movement ${followResult.step.toEventId}`}
              >
                Follow {shortAddress(followResult.step.entity)} → {followResult.step.toEventId}
              </Button>
              <div className="mt-1 text-xs text-muted-foreground/80">
                Next chronological observed event involving this address. No hop is invented.
              </div>
            </div>
          ) : (
            <div className={`${V} text-muted-foreground`}>{FOLLOW_DEAD_END}</div>
          )}
        </div>
      )}

      <div className={ROW}>
        <div className={K}>Provenance</div>
        <div className="border-l-2 pl-2.5 text-[13px] text-muted-foreground">
          {(event.provenance.kind === 'FACT' || event.provenance.kind === 'RELATION') &&
            event.provenance.statement}
          {event.provenance.kind === 'DERIVED' && (
            <>
              Computed {event.provenance.calculation} over {event.provenance.sourceEventIds.length}{' '}
              observed records (engine {String(event.provenance.inputs?.engine ?? 'unknown')}). A
              computed summary — not an observed fact.
            </>
          )}
        </div>
        {(event.provenance.kind === 'FACT' || event.provenance.kind === 'RELATION') && (
          <SourcesList sources={event.provenance.sources} />
        )}
      </div>

      {group && (
        <div className={ROW}>
          <div className={K}>Underlying observed records ({members.length})</div>
          <div className={V}>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={CHIP}
                onClick={() => onSelectEvent(m.id)}
                aria-label={`Inspect member event ${m.id}`}
              >
                <span className="font-mono">{m.id}</span> · {fmtTime(m.timestamp)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={ROW}>
        <div className={K}>Unavailable fields (build inputs)</div>
        {contract.evidence.unavailableFields.length === 0 ? (
          <div className={`${V} text-muted-foreground`}>None recorded.</div>
        ) : (
          <ul className="mt-1 list-disc pl-[18px] font-mono text-[12.5px] text-muted-foreground">
            {contract.evidence.unavailableFields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>

      <div className={ROW}>
        <div className={K}>Admission</div>
        <div className="font-mono text-xs">
          rule: {event.admissionRule} · significance: {event.significance} ·{' '}
          {event.primary ? 'primary' : 'collapsed'}
        </div>
      </div>
    </Aside>
  );
}
