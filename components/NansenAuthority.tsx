import type { InvestigationContract } from '../src/contract/types.ts';
import { buildNansenAuthority } from '../lib/nansen-authority.ts';
import { fmtUsd, shortAddress } from './format.ts';
import { ProvBadge } from './Provenance.tsx';

const COL_TITLE = 'font-mono text-xs uppercase tracking-wider text-muted-foreground/80';

/**
 * Pillar ④B — the Nansen-authority narrative. A whole-contract surface that
 * makes the Nansen-specific value legible: resolved identity, asserted
 * relationships, pre-aggregated counterparty volume, and the exact endpoints
 * each datum was cited to. Pure presentation over `buildNansenAuthority` —
 * every figure is derived from the contract alone; nothing is fetched or
 * inferred.
 */
export function NansenAuthority({ contract }: { contract: InvestigationContract }) {
  const a = buildNansenAuthority(contract);
  const total = fmtUsd(a.totalCounterpartyVolumeUsd);

  return (
    <section aria-label="What Nansen contributed" className="enter enter-6 mt-7">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={COL_TITLE}>NANSEN AUTHORITY — WHAT A RAW EXPLORER CAN&rsquo;T SEE</h2>
        <span className="prov prov-fact" title="Derived from the served contract only">
          from the contract · 0 credits
        </span>
      </div>

      <div className="theme-surface rounded-2xl border bg-card p-5">
        <p className="mb-5 max-w-[72ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Every label, link and aggregate below came from Nansen and is cited to the endpoint that
          returned it. Strip Nansen out and this case is{' '}
          <span className="font-medium text-foreground">{a.entitiesTotal} anonymous hex addresses</span>{' '}
          with no names, no funding lineage and no volume — a raw explorer would make you compute the
          rest by hand.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Identity resolution */}
          <div className="rounded-xl border border-border/70 bg-background p-4">
            <div className={`${COL_TITLE} mb-2`}>IDENTITY RESOLVED</div>
            <div className="mb-1 font-mono text-[22px] font-semibold tabular-nums">
              <span className="text-primary">{a.entitiesNamed}</span>
              <span className="text-muted-foreground/60"> / {a.entitiesTotal}</span>
            </div>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              addresses resolved to a named entity — ENS, protocol, exchange or behavioural label.
            </p>
            <ul className="grid list-none gap-1.5 p-0">
              {a.namedSamples.map((n) => (
                <li key={n.entityId} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate font-medium text-foreground">{n.name}</span>
                  {n.address && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80">
                      {shortAddress(n.address)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Relationships asserted by Nansen */}
          <div className="rounded-xl border border-border/70 bg-background p-4">
            <div className={`${COL_TITLE} mb-2 flex items-center gap-2`}>
              <span>RELATIONSHIPS ASSERTED</span>
              <ProvBadge kind="RELATION" />
            </div>
            {a.relations.length > 0 ? (
              <ul className="grid list-none gap-2 p-0">
                {a.relations.map((r) => (
                  <li key={r.id} className="text-[12.5px] leading-snug">
                    <div className="font-medium text-foreground">{r.nansenRelation}</div>
                    <div className="font-mono text-[11.5px] text-muted-foreground">
                      {r.fromName} → {r.toName}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                No related-wallet links surfaced for this subject in the captured window.
              </p>
            )}
            <p className="mt-3 text-[11.5px] text-muted-foreground/70">
              Funding lineage &amp; wallet links a block explorer never labels — each carries its own
              evidence transaction.
            </p>
          </div>

          {/* Counterparty aggregates */}
          <div className="rounded-xl border border-border/70 bg-background p-4">
            <div className={`${COL_TITLE} mb-2 flex items-center gap-2`}>
              <span>COUNTERPARTY VOLUME</span>
              <ProvBadge kind="FACT" />
            </div>
            <div className="mb-1 font-mono text-[18px] font-semibold tabular-nums">
              {total ?? '—'}
            </div>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              pre-aggregated across{' '}
              <span className="text-foreground">{a.counterpartiesTotal} counterparties</span> by Nansen.
            </p>
            <ul className="grid list-none gap-1.5 p-0">
              {a.topCounterparties.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-foreground">{c.name}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fmtUsd(c.volumeUsd) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Citation surface */}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4">
          <span className={COL_TITLE}>ENDPOINTS QUERIED</span>
          {a.endpoints.map((e) => (
            <span
              key={e.endpoint}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground"
            >
              <span className="text-foreground">{e.endpoint}</span>
              <span className="text-muted-foreground/70">×{e.citations}</span>
            </span>
          ))}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
            {a.citationsTotal} citations · {a.origins.join(' + ') || 'unavailable'}
          </span>
        </div>
      </div>
    </section>
  );
}
