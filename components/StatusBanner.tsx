/** Persistent evidence-status treatment. STATUS and COMPLETENESS are shown as
 *  separate, non-interchangeable facts; the reasons come straight from the
 *  contract. `incomplete` is the expected, structural state for a cached case,
 *  so the treatment stays calm — the amber is a marker, not an alarm. */
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
    ? 'Complete reconstruction — a live source with every coverage flag observed.'
    : 'Cached reconstruction — structurally incomplete by design. “complete” is earned only by a full live run: status reconstructed, source live-nansen, and every coverage flag observed.';
  return (
    <section
      className="theme-surface enter enter-2 mt-5 rounded-xl border bg-card p-4 text-sm"
      aria-label="Evidence status"
    >
      <div className="mb-2.5 flex flex-wrap gap-2">
        <span className={chip}>
          STATUS: <span className="text-foreground">{status}</span>
        </span>
        <span className={chip}>
          <span
            className="size-1.5 rounded-full"
            style={{ background: complete ? 'var(--primary)' : 'var(--relation)' }}
            aria-hidden
          />
          COMPLETENESS: <span className="text-foreground">{completeness}</span>
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
