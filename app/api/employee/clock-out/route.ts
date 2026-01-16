import { NextResponse } from 'next/server';
import { getClientMeta, getEmployeeWorker, requireEmployee } from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { admin, userId } = await requireEmployee(req);

    const worker = await getEmployeeWorker(admin, userId);
    if (!worker?.id || !worker?.business_id) {
      return NextResponse.json({ error: 'Not invited / not linked.' }, { status: 403 });
    }

    const wId = Number(worker.id);
    const bId = String(worker.business_id);

    // Server-side spam guard (best-effort).
    const recent = await admin
      .from('time_entry_audit')
      .select('created_at')
      .eq('user_id', userId)
      .eq('action', 'clock_out')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = recent.data?.created_at ? new Date(String(recent.data.created_at)) : null;
    if (lastAt && Date.now() - lastAt.getTime() < 1500) {
      return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 });
    }

    const nowIso = new Date().toISOString();
    const upd = await admin
      .from('time_entries')
      .update({ clock_out_at: nowIso } as any)
      .eq('business_id', bId)
      .eq('worker_id', wId)
      .is('clock_out_at', null);
    if (upd.error) throw upd.error;

    const { ip, userAgent } = await getClientMeta();
    await admin.from('time_entry_audit').insert({
      user_id: userId,
      business_id: bId,
      worker_id: wId,
      action: 'clock_out',
      ip,
      user_agent: userAgent,
    } as any);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = Number(e?.status ?? 500);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status });
  }
}


