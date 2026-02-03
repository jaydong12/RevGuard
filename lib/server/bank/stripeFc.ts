import { getStripeServer } from '../stripeServer';
import { getSupabaseAdmin } from '../supabaseAdmin';

type MatchType = 'equals' | 'contains' | 'regex';

function norm(s: string | null | undefined) {
  return String(s ?? '').trim().toLowerCase();
}

function safeRegex(pattern: string) {
  // NOTE: We keep it simple for Phase 1; Phase 2 can add validation / timeouts.
  return new RegExp(pattern, 'i');
}

function ruleMatches(rule: { match_type: MatchType; pattern: string }, merchantName: string | null) {
  const m = String(merchantName ?? '');
  const p = String(rule.pattern ?? '');
  if (!p) return false;
  if (rule.match_type === 'equals') return norm(m) === norm(p);
  if (rule.match_type === 'contains') return norm(m).includes(norm(p));
  if (rule.match_type === 'regex') return safeRegex(p).test(m);
  return false;
}

async function ensureDefaultTxCategories(businessId: string) {
  const admin = getSupabaseAdmin();
  const defaults = [
    'uncategorized',
    'income',
    'rent',
    'utilities',
    'software',
    'supplies',
    'advertising',
    'fees',
    'meals',
    'travel',
  ];

  // Create any missing categories.
  // NOTE: our unique index is on (business_id, lower(name)), which PostgREST can't target via onConflict.
  // So we insert one-by-one and ignore duplicates.
  for (const name of defaults) {
    const ins = await admin.from('tx_categories').insert({ business_id: businessId, name } as any);
    if (ins.error) {
      const code = String((ins.error as any)?.code ?? '');
      if (code !== '23505') throw ins.error; // ignore unique violations
    }
  }

  const { data, error } = await admin
    .from('tx_categories')
    .select('id,name')
    .eq('business_id', businessId);
  if (error) throw error;

  const map = new Map<string, string>();
  for (const r of (data as any[]) ?? []) {
    map.set(norm(String(r.name ?? '')), String(r.id));
  }
  const uncId = map.get('uncategorized') ?? null;
  if (!uncId) throw new Error('Failed to ensure uncategorized category.');
  return { uncategorizedId: uncId };
}

export async function syncStripeFcBusiness(opts: { businessId: string; triggeredByUserId?: string | null }) {
  const stripe = getStripeServer();
  const admin = getSupabaseAdmin();
  const businessId = opts.businessId;

  // Create run row (audit).
  const runIns = await admin
    .from('bank_sync_runs')
    .insert({ business_id: businessId, status: 'started' } as any)
    .select('id')
    .single();
  const runId = String((runIns.data as any)?.id ?? '');

  try {
    const { uncategorizedId } = await ensureDefaultTxCategories(businessId);

    const { data: conns, error: connsErr } = await admin
      .from('bank_connections')
      .select('id,provider_item_id,status,last_cursor')
      .eq('business_id', businessId)
      .eq('provider', 'stripe_fc')
      .order('created_at', { ascending: true });
    if (connsErr) throw connsErr;

    let insertedCount = 0;

    for (const conn of (conns as any[]) ?? []) {
      const connId = String(conn.id);

      const { data: accts, error: acctsErr } = await admin
        .from('bank_accounts')
        .select('id,provider_account_id')
        .eq('business_id', businessId)
        .eq('provider', 'stripe_fc')
        .eq('bank_connection_id', connId);
      if (acctsErr) throw acctsErr;

      // Fetch rules once per connection (same business).
      const { data: rules, error: rulesErr } = await admin
        .from('merchant_rules')
        .select('id,match_type,pattern,tx_category_id,active')
        .eq('business_id', businessId)
        .eq('active', true);
      if (rulesErr) throw rulesErr;
      const activeRules = ((rules as any[]) ?? [])
        .map((r) => ({
          match_type: (String(r.match_type ?? 'contains') as MatchType) || 'contains',
          pattern: String(r.pattern ?? ''),
          tx_category_id: r.tx_category_id ? String(r.tx_category_id) : null,
        }))
        .filter((r) => Boolean(r.pattern) && Boolean(r.tx_category_id));

      for (const acct of (accts as any[]) ?? []) {
        const bankAccountId = String(acct.id);
        const providerAccountId = String(acct.provider_account_id);

        // Cursor: store last imported Stripe FC transaction id (best-effort).
        // TODO(Phase2): Persist per-account cursors; Stripe webhooks/cron can ensure no gaps.
        let startingAfter: string | undefined = (conn.last_cursor ? String(conn.last_cursor) : undefined) || undefined;

        let page = 0;
        while (page < 25) {
          page++;
          const txPage = await stripe.financialConnections.transactions.list({
            account: providerAccountId,
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          } as any);

          const list = (txPage?.data ?? []) as any[];
          if (list.length === 0) break;

          const rows = list.map((t) => {
            const txId = String(t.id);
            const amountCents = Number(t.amount ?? 0);
            const currency = String(t.currency ?? 'usd').toUpperCase();
            const merchantName = (t.merchant_name ? String(t.merchant_name) : null) as string | null;
            const description = (t.description ? String(t.description) : null) as string | null;

            // Stripe returns transaction_date as unix timestamp in many APIs; tolerate both.
            const postedAt =
              typeof t.transaction_date === 'number'
                ? new Date(t.transaction_date * 1000).toISOString().slice(0, 10)
                : String(t.transaction_date ?? new Date().toISOString().slice(0, 10));

            let txCategoryId: string | null = null;
            let usedRule = false;
            for (const r of activeRules) {
              if (ruleMatches({ match_type: r.match_type, pattern: r.pattern }, merchantName)) {
                txCategoryId = String(r.tx_category_id);
                usedRule = true;
                break;
              }
            }
            if (!txCategoryId) txCategoryId = uncategorizedId;

            const direction = amountCents >= 0 ? 'inflow' : 'outflow';

            return {
              business_id: businessId,
              bank_account_id: bankAccountId,
              provider: 'stripe_fc',
              provider_transaction_id: txId, // legacy column (NOT NULL)
              provider_tx_id: txId,
              posted_at: postedAt,
              amount_cents: amountCents,
              amount: Number((amountCents / 100).toFixed(2)),
              currency,
              direction,
              merchant_name: merchantName,
              description,
              tx_category_id: txCategoryId,
              category_source: usedRule ? 'rule' : 'default',
              confidence: usedRule ? 0.9 : 0.2,
              needs_review: usedRule ? false : true,
            };
          });

          const up = await admin
            .from('bank_transactions')
            .upsert(rows as any, { onConflict: 'business_id,provider,provider_tx_id' });
          if (up.error) throw up.error;
          insertedCount += rows.length;

          startingAfter = String(list[list.length - 1]?.id ?? '');
          if (!txPage?.has_more) break;
        }

        // Best-effort cursor on connection (shared cursor across accounts in Phase 1).
        if (startingAfter) {
          await admin
            .from('bank_connections')
            .update({ last_cursor: startingAfter, last_sync_at: new Date().toISOString(), status: 'active' } as any)
            .eq('id', connId);
        } else {
          await admin
            .from('bank_connections')
            .update({ last_sync_at: new Date().toISOString(), status: 'active' } as any)
            .eq('id', connId);
        }
      }
    }

    await admin
      .from('bank_sync_runs')
      .update({ status: 'succeeded', finished_at: new Date().toISOString(), inserted_count: insertedCount } as any)
      .eq('id', runId);

    return { ok: true, runId, insertedCount };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? 'Sync failed.');
    if (runId) {
      await admin
        .from('bank_sync_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: msg } as any)
        .eq('id', runId);
    }
    // eslint-disable-next-line no-console
    console.error('STRIPE_FC_SYNC_ERROR', { businessId, triggeredBy: opts.triggeredByUserId ?? null, error: msg });
    throw e;
  }
}


