import Link from 'next/link';
import { listCaseSummaries } from '../../../lib/cases.ts';
import { PendingLink } from '../../../components/PendingLink.tsx';
import { buttonVariants } from '@/components/ui/button';

export default function CaseNotFound() {
  const cases = listCaseSummaries();
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <div className="theme-surface enter enter-1 mt-12 rounded-xl border bg-card p-6" role="alert">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Unknown case</h1>
        <p className="mb-4 max-w-[60ch] text-muted-foreground">
          No reconstruction exists for that identifier. TRACE does not guess — pick an available
          investigation:
        </p>
        <ul className="mb-4 grid list-none gap-3 p-0">
          {cases.map((c) => (
            <li key={c.caseId}>
              <PendingLink href={`/cases/${c.caseId}`} label={`Open investigation: ${c.name}`}>
                <h2 className="mb-1 text-lg font-semibold tracking-tight">{c.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{c.caseId}</p>
              </PendingLink>
            </li>
          ))}
        </ul>
        <Link className={buttonVariants({ variant: 'outline' })} href="/">
          Back to investigations
        </Link>
      </div>
    </div>
  );
}
