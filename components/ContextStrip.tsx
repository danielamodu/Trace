import type { InvestigationContract } from '../src/contract/types.ts';

/** Compact investigation context strip. One slim row — the timeline stays dominant. */
export function ContextStrip({ contract }: { contract: InvestigationContract }) {
  const inv = contract.investigation;
  const observed = inv.events.filter(
    (e) => e.type !== 'capital-consolidation' && e.type !== 'capital-dispersal',
  ).length;
  return (
    <section
      className="enter enter-1 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-b py-2.5 text-xs text-muted-foreground"
      aria-label="Investigation context"
    >
      <span className="font-semibold text-foreground">{inv.name}</span>
      <span className="font-mono">
        {inv.window.from} → {inv.window.to}
      </span>
      <span>
        status: <strong className="font-semibold text-foreground">{inv.status}</strong>
      </span>
      <span>
        evidence: <strong className="font-semibold text-foreground">{contract.completeness}</strong>
      </span>
      <span className="font-mono">
        sources: {(contract.dataSources ?? [contract.dataSource]).join(' + ')}
      </span>
      <span>{observed} observed events</span>
      <span>{inv.entities.length} entities</span>
      <span>{inv.relationships.length} relationships</span>
    </section>
  );
}
