import Stripe from 'stripe';
import { getSupabaseAdmin } from './supabaseAdmin';

type AuditStage = 'start' | 'success' | 'error';

function shouldIgnoreMissingTableOrColumn(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  // PostgREST "schema cache" errors for missing tables/columns.
  if (msg.includes('schema cache')) return true;
  if (msg.includes('could not find the table')) return true;
  if (msg.includes('does not exist')) return true;
  if (msg.includes('unknown column')) return true;
  if (msg.includes('column') && msg.includes('does not exist')) return true;
  return false;
}

async function insertAuditLog(params: {
  actorUserId: string;
  action: string;
  targetUserId: string;
  stage: AuditStage;
  targetBusinessId?: string | null;
  meta?: Record<string, any>;
}) {
  const { actorUserId, action, targetUserId, stage, targetBusinessId, meta } =
    params;
  const supabaseAdmin = getSupabaseAdmin();
  const payload: any = {
    actor_user_id: actorUserId,
    action,
    target_user_id: targetUserId,
    target_business_id: targetBusinessId ?? null,
    meta: { stage, ...(meta ?? {}) },
  };
  const { error } = await supabaseAdmin.from('audit_logs').insert(payload);
  if (error) {
    throw new Error(`Failed writing audit log: ${error.message ?? error}`);
  }
}

async function cancelStripeSubscription(subId: string) {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  const stripe = new Stripe(secretKey);
  await stripe.subscriptions.cancel(subId);
}

export async function hardDeleteUserServer(params: {
  actorUserId: string;
  action: 'HARD_DELETE_USER' | 'SELF_DELETE';
  targetUserId: string;
}) {
  if (typeof window !== 'undefined') {
    throw new Error('hardDeleteUserServer must not be imported in the browser');
  }

  const { actorUserId, action, targetUserId } = params;
  const supabaseAdmin = getSupabaseAdmin();

  // 1) Find businesses (public.business rows) owned by the target user
  const { data: businessRows, error: bizErr } = await supabaseAdmin
    .from('business')
    .select('id, stripe_subscription_id')
    .eq('owner_id', targetUserId);

  if (bizErr) throw bizErr;

  const ownedBusinessRows = (businessRows ?? []) as any[];
  const businessIds = ownedBusinessRows
    .map((b) => String(b.id))
    .filter(Boolean);

  await insertAuditLog({
    actorUserId,
    action,
    targetUserId,
    stage: 'start',
    meta: { business_ids: businessIds, businesses_count: businessIds.length },
  });

  try {
    // 2) Stripe: cancel subscriptions BEFORE deleting data
    for (const b of ownedBusinessRows) {
      const subId = String(b.stripe_subscription_id ?? '').trim();
      if (!subId) continue;
      await cancelStripeSubscription(subId);
    }

    // 3) Delete all business-scoped rows
    const deleteByBusinessTables = [
      'transactions',
      'invoices',
      'bills',
      'customers',
      'accounts',
      'journal_entries',
      'journal_lines',
      'ai_advisor_memory',
    ] as const;

    for (const businessId of businessIds) {
      for (const table of deleteByBusinessTables) {
        const { error } = await supabaseAdmin
          .from(table)
          .delete()
          .eq('business_id', businessId);

        if (error && !shouldIgnoreMissingTableOrColumn(error)) {
          throw new Error(
            `Failed deleting ${table} for business ${businessId}: ${
              error.message ?? error
            }`
          );
        }
      }

      // Known tables in this repo (best-effort)
      {
        const r1 = await supabaseAdmin
          .from('ai_insight_runs')
          .delete()
          .eq('business_id', businessId);
        if (r1.error && !shouldIgnoreMissingTableOrColumn(r1.error)) throw r1.error;
      }
      {
        const r2 = await supabaseAdmin
          .from('business_settings')
          .delete()
          .eq('business_id', businessId);
        if (r2.error && !shouldIgnoreMissingTableOrColumn(r2.error)) throw r2.error;
      }
    }

    // 4) Delete business rows
    if (businessIds.length > 0) {
      const { error: delBizErr } = await supabaseAdmin
        .from('business')
        .delete()
        .in('id', businessIds);
      if (delBizErr) throw delBizErr;
    }

    // 5) Delete profile (best-effort: table may not exist)
    for (const t of ['profiles', 'profile'] as const) {
      const byId = await supabaseAdmin.from(t).delete().eq('id', targetUserId);
      if (byId.error && !shouldIgnoreMissingTableOrColumn(byId.error)) {
        throw byId.error;
      }
      const byUserId = await supabaseAdmin
        .from(t)
        .delete()
        .eq('user_id', targetUserId);
      if (byUserId.error && !shouldIgnoreMissingTableOrColumn(byUserId.error)) {
        throw byUserId.error;
      }
    }

    // 6) User-scoped tables (best-effort)
    {
      const r = await supabaseAdmin
        .from('subscriptions')
        .delete()
        .eq('user_id', targetUserId);
      if (r.error && !shouldIgnoreMissingTableOrColumn(r.error)) throw r.error;
    }
    {
      const r = await supabaseAdmin
        .from('ai_insight_runs')
        .delete()
        .eq('user_id', targetUserId);
      if (r.error && !shouldIgnoreMissingTableOrColumn(r.error)) throw r.error;
    }

    // 7) Delete auth user
    const { error: delUserErr } = await supabaseAdmin.auth.admin.deleteUser(
      targetUserId
    );
    if (delUserErr) throw delUserErr;

    await insertAuditLog({
      actorUserId,
      action,
      targetUserId,
      stage: 'success',
      meta: { business_ids: businessIds, businesses_deleted: businessIds.length },
    });

    return {
      ok: true,
      target_user_id: targetUserId,
      businesses_deleted: businessIds.length,
      business_ids: businessIds,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? 'Unknown error');
    try {
      await insertAuditLog({
        actorUserId,
        action,
        targetUserId,
        stage: 'error',
        meta: { error: msg, business_ids: businessIds },
      });
    } catch {
      // If audit logging fails, still surface the original error.
    }
    throw e;
  }
}


