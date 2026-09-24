import type { Metadata } from 'next';

import { ReconstructForm } from '../../components/ReconstructForm.tsx';

export const metadata: Metadata = {
  title: 'Live reconstruction — TRACE',
  description: 'Reconstruct any address + window from live Nansen evidence.',
};

export default function ReconstructPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <section className="enter enter-1 py-10" aria-label="Live reconstruction">
        <p className="mb-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Live tool · BYO-key
        </p>
        <h1 className="mb-4 text-[clamp(30px,4.2vw,46px)] font-extrabold leading-[1.05] tracking-tight">
          Reconstruct any address.
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-relaxed text-muted-foreground">
          Point TRACE at an address and a window. It fetches live Nansen evidence, runs the same
          deterministic engine as the case library, and assembles an investigation contract — the one
          path that can reach a <span className="font-mono text-foreground">complete</span>{' '}
          reconstruction.
        </p>
        <div className="mt-6 max-w-[52ch]">
          <div className="theme-surface flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 font-mono text-[13px]">
            <span aria-hidden className="select-none text-muted-foreground/60">$</span>
            <code className="truncate text-foreground">
              npm run trace -- reconstruct 0x… --from … --to …
            </code>
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            The same engine on the CLI — offline for the library, credit-metered for a live run.
          </p>
        </div>
      </section>
      <ReconstructForm />
    </div>
  );
}
