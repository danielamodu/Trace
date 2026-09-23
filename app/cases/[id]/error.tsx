'use client';

import { Button } from '@/components/ui/button';

export default function CaseError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <div
        className="theme-surface enter enter-1 mt-12 rounded-xl border bg-card p-6"
        role="alert"
      >
        <h1 className="mb-2 text-2xl font-bold tracking-tight">
          Something failed while rendering this investigation
        </h1>
        <p className="mb-4 max-w-[60ch] text-muted-foreground">
          No partial reconstruction is shown rather than a broken one. You can retry loading the
          case.
        </p>
        <Button variant="outline" onClick={() => reset()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
