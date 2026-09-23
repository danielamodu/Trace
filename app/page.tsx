import { listCaseSummaries } from '../lib/cases.ts';
import { PendingLink } from '../components/PendingLink.tsx';

const CHIP =
  'inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground';

export default function Home() {
  const cases = listCaseSummaries();
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <section className="enter enter-1 py-12" aria-label="Command center">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground/80">
          command center
        </p>
        <h1 className="mb-3 text-[40px] font-extrabold leading-[1.05] tracking-tight sm:text-[52px]">
          Something happened.
        </h1>
        <p className="max-w-[58ch] text-lg text-muted-foreground">
          TRACE reconstructs how it happened — from observed onchain evidence.
        </p>
      </section>

      <h2 className="enter enter-2 mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground/80">
        INVESTIGATIONS
      </h2>
      <ul className="enter enter-3 grid list-none gap-3 p-0">
        {cases.map((c) => (
          <li key={c.caseId}>
            <PendingLink href={`/cases/${c.caseId}`} label={`Open investigation: ${c.name}`}>
              <h2 className="mb-1 text-lg font-semibold tracking-tight">{c.name}</h2>
              <p className="mb-2.5 text-[13.5px] text-muted-foreground">
                {c.chain} · {c.window.from} → {c.window.to} · {c.primaryEvents} primary events ·{' '}
                {c.entities} entities
              </p>
              <span className="flex flex-wrap gap-1.5">
                <span className={CHIP}>timeline: {c.status}</span>
                <span
                  className={CHIP}
                  style={
                    c.completeness === 'complete'
                      ? undefined
                      : { borderColor: 'var(--relation-border)', color: 'var(--relation)' }
                  }
                >
                  evidence: {c.completeness}
                </span>
                <span className={CHIP}>{c.dataSource}</span>
              </span>
            </PendingLink>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-muted-foreground/80">
        One case available in this build. Reconstructions are served from the cached investigation
        contract — no live queries.
      </p>
    </div>
  );
}
