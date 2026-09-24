import { notFound } from 'next/navigation';
import { getCaseContract } from '../../../lib/cases.ts';
import { InvestigationView } from '../../../components/InvestigationView.tsx';

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cinematic?: string }>;
}) {
  const { id } = await params;
  const { cinematic } = await searchParams;
  const contract = getCaseContract(id);
  if (contract === null) notFound();
  const inv = contract.investigation;
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <InvestigationView contract={contract} cinematic={cinematic === '1'} />
      <p className="mt-6 border-t pt-3 font-mono text-[12.5px] text-muted-foreground/80">
        Case {contract.caseId} · contract {contract.contractVersion} · engine{' '}
        {contract.engineVersion} · reconstructed {inv.reconstructedAt}
      </p>
    </div>
  );
}
