'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';

export default function CaseError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the failure in the console for debugging; never swallow it.
    console.error(error);
  }, [error]);

  return (
    <div className="page-wrap not-found">
      <div className="eyebrow">RENDER ERROR</div>
      <h1>This reconstruction hit a snag</h1>
      <p>Something threw while assembling the evidence. The contract is fine — this is just the render.</p>
      <div className="hero-actions">
        <button type="button" onClick={reset} className="button button-primary"><RotateCcw size={15} aria-hidden="true" /> Try again</button>
        <Link href="/" className="button button-secondary">Back to cases <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
    </div>
  );
}
