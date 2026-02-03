import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/server/supabaseAdmin';
import { requireAuthedUser, requireBusinessMember, requireBusinessWriteRole } from '../../../../lib/server/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normMerchantKey(v: string | null | undefined) {
  return String(v ?? '').trim().toLowerCase();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(request: Request) {
  try {
    const { user, error: authErr } = await requireAuthedUser();
    if (authErr || !user?.id) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as any;
    const businessIdRaw = String(body?.business_id ?? body?.businessId ?? '').trim();
    const txId = String(body?.transaction_id ?? body?.transactionId ?? '').trim();
    const categoryId = String(body?.category_id ?? body?.categoryId ?? '').trim();
    const applyFuture = Boolean(body?.applyFuture);

    if (!isUuid(txId)) return NextResponse.json({ error: 'Invalid transaction_id.' }, { status: 400 });
    if (!isUuid(categoryId)) return NextResponse.json({ error: 'Invalid category_id.' }, { status: 400 });

    const membership = await requireBusinessMember(businessIdRaw, user.id);
    if (membership.error || !membership.businessId) {
      return NextResponse.json({ error: membership.error ?? 'Forbidden.' }, { status: 403 });
    }
    const roleCheck = requireBusinessWriteRole((membership as any).role);
    if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: 403 });

    const businessId = membership.businessId;
    const admin = getSupabaseAdmin();

    // Load tx (for audit + optional rule creation).
    const { data: tx, error: txErr } = await admin
      .from('bank_transactions')
      .select('id,business_id,merchant_name,tx_category_id')
      .eq('id', txId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (txErr) return NextResponse.json({ error: txErr.message ?? 'Failed to load transaction.' }, { status: 500 });
    if (!(tx as any)?.id) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });

    const oldCategoryId = (tx as any)?.tx_category_id ? String((tx as any).tx_category_id) : null;
    const merchantName = (tx as any)?.merchant_name ? String((tx as any).merchant_name) : null;

    // Validate category belongs to business.
    const { data: cat, error: catErr } = await admin
      .from('tx_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (catErr) return NextResponse.json({ error: catErr.message ?? 'Failed to load category.' }, { status: 500 });
    if (!(cat as any)?.id) return NextResponse.json({ error: 'Category not found.' }, { status: 404 });

    const upd = await admin
      .from('bank_transactions')
      .update({
        tx_category_id: categoryId,
        category_source: 'user',
        confidence: 1.0,
        needs_review: false,
      } as any)
      .eq('id', txId)
      .eq('business_id', businessId);
    if (upd.error) return NextResponse.json({ error: upd.error.message ?? 'Failed to update transaction.' }, { status: 500 });

    const audit = await admin.from('tx_category_overrides').insert({
      business_id: businessId,
      bank_transaction_id: txId,
      user_id: user.id,
      merchant_name: merchantName,
      old_category_id: oldCategoryId,
      new_category_id: categoryId,
      apply_future: applyFuture,
    } as any);
    if (audit.error) {
      // eslint-disable-next-line no-console
      console.error('TX_CATEGORY_OVERRIDE_INSERT_ERROR', audit.error);
      // don't fail the main update
    }

    if (applyFuture && merchantName) {
      const key = normMerchantKey(merchantName);
      if (key) {
        const ruleUp = await admin
          .from('merchant_rules')
          .upsert(
            {
              business_id: businessId,
              merchant_key: key,
              match_type: 'contains',
              pattern: merchantName,
              tx_category_id: categoryId,
              created_by: user.id,
              active: true,
            } as any,
            { onConflict: 'business_id,merchant_key' }
          );
        if (ruleUp.error) {
          // eslint-disable-next-line no-console
          console.error('MERCHANT_RULE_UPSERT_ERROR', ruleUp.error);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('TX_SET_CATEGORY_ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to save category.' }, { status: 500 });
  }
}


