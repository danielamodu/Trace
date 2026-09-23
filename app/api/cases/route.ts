import { NextResponse } from 'next/server';
import { listCaseSummaries } from '../../../lib/cases.ts';

/** GET /api/cases — read-only case listing. */
export async function GET() {
  return NextResponse.json({ cases: listCaseSummaries() });
}
