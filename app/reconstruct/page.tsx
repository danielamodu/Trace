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
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground/80">
          live tool
        </p>
        <h1 className="mb-3 text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[44px]">
          Reconstruct any address.
        </h1>
        <p className="max-w-[62ch] text-lg text-muted-foreground">
          Point TRACE at an address and a window. It fetches live Nansen evidence, runs the same
          deterministic engine as the case library, and assembles an investigation contract — the one
          path that can reach a <span className="font-mono">complete</span> reconstruction.
        </p>
      </section>
      <ReconstructForm />
    </div>
  );
}
