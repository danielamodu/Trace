import type { TraceEvent } from '../src/types/events.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import { eventOrigin, originLabel } from '../lib/sources.ts';
import { eventTypeLabel, explorerTxUrl, fmtTime, fmtUsd, shortAddress } from './format.ts';
import { ProvBadge } from './Provenance.tsx';

const COL_TITLE = 'font-mono text-xs uppercase tracking-wider text-muted-foreground/80';

/**
 * The Proof — a compact evidence receipt bound to the stage's current step (the
 * replay cursor). For the step being shown it renders the exact Nansen origin,
 * the verbatim provenance statement, and the classification badge, so every
 * revealed movement is backed by a visible, auditable source. Derived summaries
 * say so and point at their member records — never a fabricated endpoint. Pure
 * presentation over the contract; nothing is inferred or interpolated.
 */
export function EvidenceReceipt({
  contract,
  event,
}: {
  contract: InvestigationContract;
  event: TraceEvent | null;
}) {
  return (
    <section aria-label="Evidence behind the current step" className="enter enter-3 mt-3">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={COL_TITLE}>THE PROOF — EVIDENCE BEHIND THIS STEP</h2>
        <span className="prov prov-fact" title="TRACE never runs a model over evidence">
          deterministic · no LLM
        </span>
      </div>
      <div className="theme-surface rounded-2xl border bg-card p-4">
        {event ? (
          <Receipt contract={contract} event={event} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No step at the current position. Press play, or pick a movement, to see its evidence.
          </p>
        )}
      </div>
    </section>
  );
}

/** The receipt body for one event — mirrors the inspector's provenance discipline. */
function Receipt({ contract, event }: { contract: InvestigationContract; event: TraceEvent }) {
  const origin = eventOrigin(contract, event.id);
  const value =
    'value' in event && event.value && typeof event.value.valueUsd === 'number'
      ? fmtUsd(event.value.valueUsd)
      : null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ProvBadge kind={event.provenance.kind} />
        <span className="text-sm font-semibold">{eventTypeLabel(event.type)}</span>
        {value && (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{value}</span>
        )}
        <time dateTime={event.timestamp} className="font-mono text-[11.5px] text-muted-foreground/80">
          {fmtTime(event.timestamp)}
        </time>
        <span className="ml-auto inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          source: {origin}
        </span>
      </div>

      <p className="border-l-2 pl-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
        {(event.provenance.kind === 'FACT' || event.provenance.kind === 'RELATION') &&
          event.provenance.statement}
        {event.provenance.kind === 'DERIVED' && (
          <>
            Computed {event.provenance.calculation} over {event.provenance.sourceEventIds.length}{' '}
            observed records (engine {String(event.provenance.inputs?.engine ?? 'unknown')}) — a
            derived summary, not an observed transaction.
          </>
        )}
      </p>

      {event.provenance.kind === 'FACT' || event.provenance.kind === 'RELATION' ? (
        <ul className="grid list-none gap-1.5 p-0 sm:grid-cols-2">
          {event.provenance.sources.map((s, i) => (
            <li
              key={i}
              className="rounded-md border border-border/70 bg-background px-2.5 py-2 font-mono text-[11.5px] text-muted-foreground"
            >
              <div className="text-foreground">Nansen · {s.source}</div>
              <div>captured {s.capturedAt}</div>
              {s.requestId && <div className="truncate">request {s.requestId}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-[11.5px] text-muted-foreground/80">
          No direct endpoint — this row is derived from its member records, each independently sourced.
        </p>
      )}

      {event.txHash && (
        <div className="font-mono text-[11.5px]">
          <span className="text-muted-foreground">tx </span>
          <a
            className="text-primary underline underline-offset-2"
            href={explorerTxUrl(event.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(event.txHash)}
          </a>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        {originLabel(origin)}. Values render verbatim from the contract; missing values stay missing.
      </p>
    </div>
  );
}
