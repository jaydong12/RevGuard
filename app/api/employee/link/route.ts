import { NextResponse } from 'next/server';
import { requireEmployee, tryLinkWorkerOnFirstLogin } from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { admin, userId, email } = await requireEmployee(req);
    const res = await tryLinkWorkerOnFirstLogin({ admin, userId, email });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    const status = Number(e?.status ?? 500);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status });
  }
}


