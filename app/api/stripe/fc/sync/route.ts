import { NextResponse } from 'next/server';
import { syncStripeFcBusiness } from '../../../../../lib/server/bank/stripeFc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-only endpoint (for cron/webhooks/ops). Do NOT call from the browser.
export async function POST(request: Request) {
  try {
    const secret = process.env.BANK_SYNC_SECRET ?? '';
    const got = request.headers.get('x-bank-sync-secret') ?? '';
    if (!secret || got !== secret) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as any;
    const businessId = String(body?.business_id ?? body?.businessId ?? '').trim();
    if (!businessId) return NextResponse.json({ error: 'Missing business_id.' }, { status: 400 });

    const res = await syncStripeFcBusiness({ businessId, triggeredByUserId: null });
    return NextResponse.json(res);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('STRIPE_FC_SYNC_ROUTE_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Sync failed.' }, { status: 500 });
  }
}


