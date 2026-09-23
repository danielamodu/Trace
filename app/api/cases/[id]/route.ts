import { NextResponse } from 'next/server';
import { getCaseContract, getService } from '../../../../lib/cases.ts';

/** GET /api/cases/[id] — read-only full contract. Unknown ids → 404 JSON. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contract = getCaseContract(id);
  if (contract === null) {
    return NextResponse.json(
      { error: 'unknown case', caseId: id, knownCaseIds: [...getService().caseIds] },
      { status: 404 },
    );
  }
  return NextResponse.json(contract);
}
