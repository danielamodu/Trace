import type { ReactNode } from 'react';
import type { Entity } from '../src/types/entities.ts';
import type { TraceEvent } from '../src/types/events.ts';
import { eventTypeFamily, eventTypeLabel, fmtTime, fmtUsd, shortAddress } from './format.ts';
import { ProvBadge } from './Provenance.tsx';

function isGroup(e: TraceEvent): boolean {
  return e.type === 'capital-consolidation' || e.type === 'capital-dispersal';
}

function memberIds(e: TraceEvent): string[] {
  if (e.provenance.kind === 'DERIVED') return [...e.provenance.sourceEventIds].sort();
  return [];
}

/** Small neutral status pill (replay cursor / collapsed / trail marker). Tone
 *  reuses the provenance vocabulary hues without asserting provenance itself. */
function Pill({ tone, children }: { tone: 'fact' | 'derived'; children: ReactNode }) {
  const color = tone === 'derived' ? 'var(--derived)' : 'var(--fact)';
  const border = tone === 'derived' ? 'var(--derived-border)' : 'var(--fact-border)';
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px]"
      style={{ color, borderColor: border }}
    >
      {children}
    </span>
  );
}

const familyClass: Record<'move' | 'rel' | 'derived', string> = {
  move: 'text-muted-foreground',
  rel: 'text-relation',
  derived: 'text-derived',
};
export function EventCard({
  event,
  selected,
  highlighted,
  isCursor,
  trailMark,
  trailOrder,
  onSelect,
  entitiesById,
  expanded,
  onToggleGroup,
  memberEvents,
}: {
  event: TraceEvent;
  selected: boolean;
  highlighted: boolean;
  isCursor: boolean;
  trailMark: 'from' | 'to' | null;
  trailOrder: number | null;
  onSelect: (id: string) => void;
  entitiesById: Map<string, Entity>;
  expanded: boolean;
  onToggleGroup: (id: string) => void;
  memberEvents: TraceEvent[];
}) {
  const group = isGroup(event);
  const value =
    'value' in event && event.value && typeof event.value.valueUsd === 'number'
      ? fmtUsd(event.value.valueUsd)
      : null;

  const dot = selected
    ? 'before:border-foreground before:bg-foreground'
    : group
      ? 'before:border-primary'
      : 'before:border-muted-foreground';

  const card = [
    'theme-surface overflow-hidden rounded-lg border bg-card',
    selected ? 'border-primary' : highlighted ? 'border-muted-foreground/50' : '',
    isCursor ? 'shadow-[inset_3px_0_0_var(--primary)]' : '',
    event.primary ? '' : 'opacity-85',
  ].join(' ');

  return (
    <li
      className={`relative mb-3 before:absolute before:top-5 before:-left-[25px] before:size-2.5 before:rounded-full before:border-2 before:bg-background before:content-[''] ${dot}`}
    >
      <article className={card}>
        <button
          type="button"
          className="block w-full cursor-pointer p-3.5 text-left"
          onClick={() => onSelect(event.id)}
          aria-current={selected ? 'true' : undefined}
          aria-label={`Select event ${event.order}: ${event.title}`}
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground/80">#{event.order}</span>
            <span
              className={`text-xs font-bold uppercase tracking-wider ${familyClass[eventTypeFamily(event.type)]}`}
            >
              {eventTypeLabel(event.type)}
            </span>
            <ProvBadge kind={event.provenance.kind} />
            {isCursor && <Pill tone="derived">Replay cursor</Pill>}
            {!event.primary && <Pill tone="fact">Collapsed</Pill>}
            {trailMark === 'from' && <Pill tone="derived">Followed from here → #{trailOrder}</Pill>}
            {trailMark === 'to' && <Pill tone="derived">← Followed from #{trailOrder}</Pill>}
          </div>
          <p className="mb-1.5 text-[14.5px] font-semibold">{event.title}</p>
          <p className="my-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            <time dateTime={event.timestamp}>{fmtTime(event.timestamp)}</time>
          </p>
          <p className="my-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            {event.participants
              .slice(0, 3)
              .map((p) => {
                const en = entitiesById.get(p.entityId);
                const label = en && en.labels.length > 0 ? en.labels[0].label : null;
                const addr = en?.address ?? p.entityId;
                return `${p.side}:${label ?? shortAddress(addr)}`;
              })
              .join('  ·  ')}
          </p>
          {value !== null ? (
            <p className="mt-1 font-mono text-[13px] font-semibold tabular-nums text-foreground">
              {value}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[13px] tabular-nums text-muted-foreground/80">
              USD unavailable — not estimated
            </p>
          )}
          {event.method && (
            <p className="my-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              method: {event.method}
            </p>
          )}
        </button>
        {group && (
          <>
            <button
              type="button"
              className="block w-full cursor-pointer border-t bg-secondary px-3.5 py-2 text-left text-[13px] text-primary hover:bg-secondary/70"
              onClick={() => onToggleGroup(event.id)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} ${memberEvents.length} observed records in ${event.id}`}
            >
              {expanded
                ? `Hide observed records (${memberEvents.length})`
                : `Show observed records (${memberEvents.length}) — stays marked Derived`}
            </button>
            {expanded && (
              <ul
                className="m-0 list-none border-t border-dashed py-2 pr-2.5 pl-[22px]"
                aria-label={`Observed records in ${event.id}`}
              >
                {memberEvents.map((m) => (
                  <li key={m.id} className="my-1.5">
                    <button
                      type="button"
                      className="block w-full cursor-pointer rounded-md border bg-background px-2.5 py-2 text-left text-[13px] hover:border-primary"
                      onClick={() => onSelect(m.id)}
                      aria-label={`Select member event ${m.id}: ${m.title}`}
                    >
                      <ProvBadge kind={m.provenance.kind} /> {m.title}
                      <br />
                      <span className="font-mono text-xs text-muted-foreground">
                        {fmtTime(m.timestamp)} · {m.id}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </article>
    </li>
  );
}
export function Timeline({
  events,
  selectedId,
  highlightIds,
  cursorId,
  trail,
  onSelect,
  entitiesById,
  eventsById,
  expandedGroups,
  onToggleGroup,
  showCollapsed,
  onToggleCollapsed,
}: {
  events: TraceEvent[];
  selectedId: string | null;
  highlightIds: string[];
  cursorId: string | null;
  trail: { fromId: string; toId: string; entity: string } | null;
  onSelect: (id: string) => void;
  entitiesById: Map<string, Entity>;
  eventsById: Map<string, TraceEvent>;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (id: string) => void;
  showCollapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const collapsedCount = events.filter((e) => !e.primary).length;
  const visible = events.filter((e) => e.primary || showCollapsed);
  const highlighted = new Set(highlightIds);
  const orderOf = (id: string): number | null => eventsById.get(id)?.order ?? null;
  if (events.length === 0) {
    return (
      <div className="theme-surface mt-6 rounded-lg border bg-card p-8 text-center" role="status">
        <h2 className="mb-2 text-lg font-semibold">No events in this reconstruction</h2>
        <p className="text-muted-foreground">
          No records cleared admission, or the build inputs were empty. Gaps are listed below.
        </p>
      </div>
    );
  }
  return (
    <div>
      <ol
        className="m-0 list-none border-l-2 border-border pl-[18px]"
        aria-label="Reconstruction timeline, chronological"
      >
        {visible.map((e) => (
          <EventCard
            key={e.id}
            event={e}
            selected={e.id === selectedId}
            highlighted={highlighted.has(e.id)}
            isCursor={e.id === cursorId}
            trailMark={trail && e.id === trail.fromId ? 'from' : trail && e.id === trail.toId ? 'to' : null}
            trailOrder={
              trail && e.id === trail.fromId
                ? orderOf(trail.toId)
                : trail && e.id === trail.toId
                  ? orderOf(trail.fromId)
                  : null
            }
            onSelect={onSelect}
            entitiesById={entitiesById}
            expanded={expandedGroups[e.id] === true}
            onToggleGroup={onToggleGroup}
            memberEvents={memberIds(e)
              .map((id) => eventsById.get(id))
              .filter((m): m is TraceEvent => m !== undefined)}
          />
        ))}
      </ol>
      {collapsedCount > 0 && (
        <div
          className="theme-surface mt-3.5 rounded-lg border border-dashed bg-card p-3.5"
          role="group"
          aria-label="Low-significance event filter"
        >
          <p className="text-[13px] text-muted-foreground">
            Noise filter: {collapsedCount} low-significance event
            {collapsedCount === 1 ? ' is' : 's are'} hidden. Transfers below the investigation
            threshold are collapsed; the underlying evidence is preserved.
          </p>
          <p className="mt-2">
            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border bg-transparent px-3 py-2 text-[13px] text-muted-foreground hover:border-primary hover:text-foreground"
              onClick={onToggleCollapsed}
              aria-expanded={showCollapsed}
            >
              {showCollapsed
                ? `Hide ${collapsedCount} below-threshold events`
                : `Show all ${collapsedCount} below-threshold events`}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
