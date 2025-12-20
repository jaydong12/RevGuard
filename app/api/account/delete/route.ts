import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Require Authorization: Bearer <access_token>
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as { confirm?: string };
    const confirm = String(body.confirm ?? '').trim();
    if (confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'Safety check failed. Include { confirm: "DELETE" }.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: tokenUserRes, error: tokenUserErr } =
      await supabaseAdmin.auth.getUser(token);
    const user = tokenUserRes?.user ?? null;
    if (tokenUserErr || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // IMPORTANT: Delete business-scoped rows first (FK-safe), THEN delete the auth user.
    // This avoids FK constraint failures when the DB does not have full cascade rules.

    // 1) Find businesses owned by this user.
    const { data: bizRows, error: bizErr } = await supabaseAdmin
      .from('business')
      .select('id')
      .eq('owner_id', userId);

    if (bizErr) {
      return NextResponse.json(
        { error: bizErr.message ?? 'Failed to load businesses.' },
        { status: 500 }
      );
    }

    const businessIds = ((bizRows ?? []) as any[])
      .map((r) => String((r as any)?.id ?? ''))
      .filter(Boolean);

    // Helper: delete rows by business_id across a set of business ids.
    async function deleteByBusinessIds(table: string) {
      if (businessIds.length === 0) return;
      const { error } = await supabaseAdmin
        .from(table as any)
        .delete()
        .in('business_id', businessIds as any);
      if (error) throw new Error(`[${table}] ${error.message ?? String(error)}`);
    }

    async function deleteByColumnIn(table: string, column: string) {
      if (businessIds.length === 0) return;
      // Cast to any to avoid supabase-js generic instantiation explosions for dynamic columns.
      const sb: any = supabaseAdmin as any;
      const { error } = await sb.from(table).delete().in(column, businessIds);
      if (error) throw new Error(`[${table}.${column}] ${error.message ?? String(error)}`);
    }

    // Helper: allow optional tables (ignore missing relation / schema-cache errors).
    function isMissingTableError(err: any): boolean {
      const msg = String(err?.message ?? err ?? '').toLowerCase();
      return (
        msg.includes('could not find the table') ||
        msg.includes('schema cache') ||
        msg.includes('does not exist') ||
        msg.includes('relation') ||
        msg.includes('42p01')
      );
    }

    // 2) Delete child rows in order (per request).
    // ai_advisor_memory (some deployments use ai_business_memory instead)
    try {
      await deleteByBusinessIds('ai_advisor_memory');
    } catch (e: any) {
      if (!isMissingTableError(e)) throw e;
    }
    try {
      await deleteByBusinessIds('ai_business_memory');
    } catch (e: any) {
      if (!isMissingTableError(e)) throw e;
    }

    // transactions (by business_id)
    await deleteByBusinessIds('transactions');

    // other business-scoped tables (best-effort; ignore if table not present)
    for (const t of [
      'ai_insight_runs',
      'ai_advice_log',
      'ai_recommendations',
      'ai_outcome_snapshots',
      'business_settings',
    ]) {
      try {
        await deleteByBusinessIds(t);
      } catch (e: any) {
        if (!isMissingTableError(e)) throw e;
      }
    }
    try {
      // audit_logs uses target_business_id in this schema
      await deleteByColumnIn('audit_logs', 'target_business_id');
    } catch (e: any) {
      if (!isMissingTableError(e)) throw e;
    }

    // invoices: delete invoice_items first (FK), then invoices
    if (businessIds.length > 0) {
      try {
        const { data: invRows, error: invErr } = await supabaseAdmin
          .from('invoices')
          .select('id')
          .in('business_id', businessIds as any);
        if (invErr) throw new Error(`[invoices] ${invErr.message ?? String(invErr)}`);
        const invoiceIds = ((invRows ?? []) as any[])
          .map((r) => String((r as any)?.id ?? ''))
          .filter(Boolean);
        if (invoiceIds.length > 0) {
          const { error: itemsErr } = await supabaseAdmin
            .from('invoice_items')
            .delete()
            .in('invoice_id', invoiceIds as any);
          if (itemsErr && !isMissingTableError(itemsErr)) {
            throw new Error(`[invoice_items] ${itemsErr.message ?? String(itemsErr)}`);
          }
        }
      } catch (e: any) {
        // invoice_items might not exist in some deployments; invoices always should.
        if (!isMissingTableError(e)) throw e;
      }
    }
    await deleteByBusinessIds('invoices');

    // bills / customers (by business_id)
    await deleteByBusinessIds('bills');
    await deleteByBusinessIds('customers');

    // 3) Delete businesses (by owner_id)
    const { error: delBizErr } = await supabaseAdmin
      .from('business')
      .delete()
      .eq('owner_id', userId);
    if (delBizErr) {
      return NextResponse.json(
        { error: delBizErr.message ?? 'Failed to delete businesses.' },
        { status: 500 }
      );
    }

    // 4) Finally delete the auth user.
    const { error: delUserErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (delUserErr) {
      return NextResponse.json(
        { error: delUserErr.message ?? 'Delete user failed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('SELF_DELETE_ERROR', e);
    return NextResponse.json(
      { error: String(e?.message ?? 'Unexpected error') },
      { status: 500 }
    );
  }
}


