/** Persistent evidence-status treatment. STATUS and COMPLETENESS are shown as
 *  separate, non-interchangeable facts; the key limitation is always visible. */
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
    'inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground';
  const complete = completeness === 'complete';
  return (
    <section
      className="theme-surface enter enter-2 mt-4 rounded-lg border border-l-[3px] bg-card p-3.5 text-sm"
      style={{ borderLeftColor: 'var(--relation)' }}
      aria-label="Evidence status"
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <span className={`${chip} text-foreground`}>STATUS: {status}</span>
        <span
          className={chip}
          style={complete ? undefined : { color: 'var(--relation)', borderColor: 'var(--relation-border)' }}
        >
          COMPLETENESS: {completeness}
        </span>
        <span className={chip}>SOURCE: {dataSource}</span>
      </div>
      <p className="text-muted-foreground">
        Transaction window incomplete — captured transaction sample contains latest-first dust rows;
        exploit-day rows require pagination/live capture.
      </p>
      <details className="mt-1.5 group">
        <summary className="cursor-pointer text-sm text-foreground marker:text-muted-foreground">
          Why is this incomplete? ({reasons.length} reasons)
        </summary>
        <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
