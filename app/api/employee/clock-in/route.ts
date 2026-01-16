import { NextResponse } from 'next/server';
import { getClientMeta, getEmployeeWorker, requireEmployee, tryLinkWorkerOnFirstLogin } from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { admin, userId, email } = await requireEmployee(req);

    let worker = await getEmployeeWorker(admin, userId);
    if (!worker) {
      await tryLinkWorkerOnFirstLogin({ admin, userId, email }).catch(() => null);
      worker = await getEmployeeWorker(admin, userId);
    }
    if (!worker?.id || !worker?.business_id) {
      return NextResponse.json({ error: 'Not invited / not linked.' }, { status: 403 });
    }

    const wId = Number(worker.id);
    const bId = String(worker.business_id);
    if (!Boolean((worker as any)?.is_active ?? true)) {
      return NextResponse.json({ error: 'Worker is inactive.' }, { status: 403 });
    }

    // Server-side spam guard (best-effort).
    const recent = await admin
      .from('time_entry_audit')
      .select('created_at')
      .eq('user_id', userId)
      .eq('action', 'clock_in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = recent.data?.created_at ? new Date(String(recent.data.created_at)) : null;
    if (lastAt && Date.now() - lastAt.getTime() < 1500) {
      return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 });
    }

    // If an open shift exists, do nothing (idempotent-ish).
    const open = await admin
      .from('time_entries')
      .select('id')
      .eq('business_id', bId)
      .eq('worker_id', wId)
      .is('clock_out_at', null)
      .limit(1)
      .maybeSingle();
    if (open.error) throw open.error;
    if (open.data?.id) {
      return NextResponse.json({ ok: true, alreadyOpen: true });
    }

    const nowIso = new Date().toISOString();
    const ins = await admin.from('time_entries').insert({
      business_id: bId,
      worker_id: wId,
      clock_in_at: nowIso,
      clock_out_at: null,
    } as any);
    if (ins.error) throw ins.error;

    const { ip, userAgent } = getClientMeta();
    await admin.from('time_entry_audit').insert({
      user_id: userId,
      business_id: bId,
      worker_id: wId,
      action: 'clock_in',
      ip,
      user_agent: userAgent,
    } as any);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = Number(e?.status ?? 500);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status });
  }
}


