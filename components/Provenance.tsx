import { provenanceLabel } from './format.ts';

/** Fixed-vocabulary provenance badge: Observed / Reported relationship / Derived.
 *  Semantic hue per kind (see `.prov-*` in globals.css) — never decorative. */
export function ProvBadge({ kind }: { kind: string }) {
  const cls = kind === 'FACT' ? 'prov-fact' : kind === 'RELATION' ? 'prov-relation' : 'prov-derived';
  return (
    <span className={`prov ${cls}`} title={`Provenance: ${kind}`}>
      {provenanceLabel(kind)}
    </span>
  );
}
