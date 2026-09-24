import type { Metadata } from 'next';

import { VerifyDropzone } from '../../components/VerifyDropzone.tsx';

export const metadata: Metadata = {
  title: 'Verify an artifact — TRACE',
  description: 'Re-derive any TRACE contract’s verdict offline — schema, completeness, evidence tallies, and a content fingerprint. No credits, no server.',
};

export default function VerifyPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <section className="enter enter-1 py-10" aria-label="Verify a TRACE artifact">
        <p className="mb-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          The flex · portable proof
        </p>
        <h1 className="mb-4 text-[clamp(30px,4.2vw,46px)] font-extrabold leading-[1.05] tracking-tight">
          Don&rsquo;t trust it. Verify it.
        </h1>
        <p className="max-w-[64ch] text-[17px] leading-relaxed text-muted-foreground">
          Every TRACE reconstruction is a portable artifact that carries its own proof. Drop one in and
          this page re-derives its verdict from the artifact alone — schema and cross-references, the{' '}
          <span className="font-mono text-foreground">complete</span>/
          <span className="font-mono text-foreground">incomplete</span> rule, every evidence tally, and a
          content fingerprint — entirely in your browser. No server, no Nansen call, no credits.
        </p>
        <div className="mt-6 max-w-[54ch]">
          <div className="theme-surface flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 font-mono text-[13px]">
            <span aria-hidden className="select-none text-muted-foreground/60">$</span>
            <code className="truncate text-foreground">npm run trace -- verify path/to/contract.json</code>
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            The same verification on the CLI — identical checks, identical fingerprint.
          </p>
        </div>
      </section>
      <VerifyDropzone />
    </div>
  );
}
