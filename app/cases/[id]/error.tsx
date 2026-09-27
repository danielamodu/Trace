'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function CaseError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the failure in the console for debugging; never swallow it.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-6xl">🧩</div>
      <h1 className="text-2xl font-black text-ink">This reconstruction hit a snag</h1>
      <p className="max-w-sm font-semibold text-wolf">
        Something threw while assembling the evidence. The contract is fine — this is just the render.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-green">Try again</button>
        <Link href="/" className="btn btn-white">Back to cases</Link>
      </div>
    </main>
  );
}
