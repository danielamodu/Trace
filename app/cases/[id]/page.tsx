import { notFound } from 'next/navigation';
import { getCaseContract } from '@/lib/cases.ts';
import { CasePath } from '@/components/CasePath.tsx';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contract = getCaseContract(id);
  if (!contract) notFound();
  return <CasePath contract={contract} />;
}
