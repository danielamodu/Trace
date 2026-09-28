import { notFound } from 'next/navigation';
import { getCaseContract } from '@/lib/cases.ts';
import { CaseWorkspace } from '@/components/CaseWorkspace.tsx';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contract = getCaseContract(id);
  if (!contract) notFound();
  return <CaseWorkspace contract={contract} />;
}
