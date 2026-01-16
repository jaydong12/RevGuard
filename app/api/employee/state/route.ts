import { NextResponse } from 'next/server';
import { getEmployeeWorker, requireEmployee, tryLinkWorkerOnFirstLogin } from '../_utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { admin, userId, email } = await requireEmployee(req);

    let worker = await getEmployeeWorker(admin, userId);
    if (!worker) {
      await tryLinkWorkerOnFirstLogin({ admin, userId, email }).catch(() => null);
      worker = await getEmployeeWorker(admin, userId);
    }

    if (!worker?.id || !worker?.business_id) {
      return NextResponse.json({ ok: true, worker: null, openEntry: null, entries: [] });
    }

    const wId = Number(worker.id);
    const bId = String(worker.business_id);

    const open = await admin
      .from('time_entries')
      .select('id,business_id,worker_id,clock_in_at,clock_out_at')
      .eq('business_id', bId)
      .eq('worker_id', wId)
      .is('clock_out_at', null)
      .order('clock_in_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open.error) throw open.error;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startIso = start.toISOString();

    const entries = await admin
      .from('time_entries')
      .select('id,business_id,worker_id,clock_in_at,clock_out_at')
      .eq('business_id', bId)
      .eq('worker_id', wId)
      .gte('clock_in_at', startIso)
      .order('clock_in_at', { ascending: false })
      .limit(50);
    if (entries.error) throw entries.error;

    return NextResponse.json({
      ok: true,
      worker: {
        id: wId,
        business_id: bId,
        name: String((worker as any)?.name ?? ''),
        is_active: Boolean((worker as any)?.is_active ?? true),
        email: String((worker as any)?.email ?? ''),
      },
      openEntry: open.data ?? null,
      entries: entries.data ?? [],
    });
  } catch (e: any) {
    const status = Number(e?.status ?? 500);
    return NextResponse.json({ error: String(e?.message ?? 'Unexpected error') }, { status });
  }
}


