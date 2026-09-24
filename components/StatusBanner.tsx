/** Persistent evidence-status treatment. STATUS and COMPLETENESS are shown as
 *  separate, non-interchangeable facts; the reasons come straight from the
 *  contract. `incomplete` is the expected, structural state for a cached case,
 *  so that treatment stays calm — the marker is a dot, not an alarm. `complete`
 *  is the earned payoff a fixture-cache case can never reach (live source + every
 *  coverage flag observed), so it gets a confident ember seal to match. */
export function StatusBanner({
  status,
  completeness,
  dataSource,
  reasons,
}: {
  status: string;
  completeness: string;
  dataSource: string;
  reasons: string[];
}) {
  const chip =
    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-mono text-[11.5px] text-muted-foreground';
  const complete = completeness === 'complete';
  const lead = complete
    ? 'Complete reconstruction — reconstructed live from Nansen with every coverage flag observed. This is the state a cached case can never reach.'
    : 'Cached reconstruction — structurally incomplete by design. “complete” is earned only by a full live run: status reconstructed, source live-nansen, and every coverage flag observed.';
  return (
    <section
      className="theme-surface enter enter-2 mt-5 rounded-xl border bg-card p-4 text-sm"
      aria-label="Evidence status"
      style={
        complete
          ? {
              borderColor: 'var(--primary)',
              background: 'color-mix(in oklch, var(--primary) 7%, var(--card))',
            }
          : undefined
      }
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        {complete && (
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 font-mono text-[11.5px] font-semibold uppercase tracking-wider"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <svg viewBox="0 0 16 16" className="size-3" aria-hidden fill="none">
              <path
                d="M3.5 8.5l3 3 6-7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Complete · live
          </span>
        )}
        <span className={chip}>
          STATUS: <span className="text-foreground">{status}</span>
        </span>
        <span className={chip} style={complete ? { borderColor: 'var(--primary)' } : undefined}>
          <span
            className="size-1.5 rounded-full"
            style={{ background: complete ? 'var(--primary)' : 'var(--relation)' }}
            aria-hidden
          />
          COMPLETENESS:{' '}
          <span
            className={complete ? 'font-medium' : 'text-foreground'}
            style={complete ? { color: 'var(--primary)' } : undefined}
          >
            {completeness}
          </span>
        </span>
        <span className={chip}>
          SOURCE: <span className="text-foreground">{dataSource}</span>
        </span>
      </div>
      <p className="max-w-[82ch] leading-relaxed text-muted-foreground">{lead}</p>
      {reasons.length > 0 && (
        <details className="group mt-2.5">
          <summary className="cursor-pointer text-sm text-foreground marker:text-muted-foreground">
            Why is this {completeness}? ({reasons.length} {reasons.length === 1 ? 'reason' : 'reasons'})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] text-muted-foreground">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
