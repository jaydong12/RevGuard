import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type BusinessIntelligenceMemory = {
  business_id: string;
  business_dna: any;
  owner_preferences: any;
  decision_history: any;
  ai_assumptions: any;
  updated_at: string;
};

export type MemoryDirective = {
  confidence?: number; // 0..1
  needs_confirmation?: boolean;
  question?: string | null;
  update?: {
    business_dna?: any;
    owner_preferences?: any;
    ai_assumptions?: any;
    decision_event?: any; // appended to decision_history
  } | null;
};

function parseCookie(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(val);
  }
  return out;
}

export function getAccessTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  const cookies = parseCookie(request.headers.get('cookie'));
  return cookies.rg_at || null;
}

export function createAuthedSupabaseClient(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function resolveBusinessIdForUser(
  supabase: SupabaseClient,
  userId: string,
  requestedBusinessId?: string | null
): Promise<string | null> {
  if (requestedBusinessId) {
    const scoped = await supabase
      .from('business')
      .select('id')
      .eq('id', requestedBusinessId)
      .eq('owner_id', userId)
      .maybeSingle();
    if (!scoped.error && scoped.data?.id) return String(scoped.data.id);
  }

  const first = await supabase
    .from('business')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (first.error || !first.data?.id) return null;
  return String(first.data.id);
}

export async function loadOrCreateBusinessMemory(
  supabase: SupabaseClient,
  businessId: string
): Promise<BusinessIntelligenceMemory | null> {
  try {
    const res = await supabase
      .from('business_intelligence_memory')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();

    if (res.data?.business_id) return res.data as any;

    // Create empty row (best-effort; if table isn't migrated yet, just return null).
    if (res.error) return null;

    const ins = await supabase
      .from('business_intelligence_memory')
      .insert({
        business_id: businessId,
        business_dna: {},
        owner_preferences: {},
        decision_history: [],
        ai_assumptions: {},
      } as any)
      .select('*')
      .single();

    if (ins.error) return null;
    return ins.data as any;
  } catch {
    return null;
  }
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(a) || Array.isArray(b)) return b ?? a;
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const out: any = { ...a };
    for (const k of Object.keys(b)) {
      out[k] = deepMerge(a[k], b[k]);
    }
    return out;
  }
  return b ?? a;
}

function clampDecisionHistory(list: any, max = 50): any[] {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}

export async function applyMemoryDirective(params: {
  supabase: SupabaseClient;
  businessId: string;
  current: BusinessIntelligenceMemory | null;
  directive: MemoryDirective | null | undefined;
}): Promise<BusinessIntelligenceMemory | null> {
  const { supabase, businessId, current, directive } = params;
  if (!directive?.update) return current;

  const confidence = Number(directive.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0.85) {
    // Low confidence: do not update automatically.
    return current;
  }

  const update = directive.update ?? {};
  const next: any = {
    business_id: businessId,
    business_dna: deepMerge(current?.business_dna ?? {}, update.business_dna ?? {}),
    owner_preferences: deepMerge(current?.owner_preferences ?? {}, update.owner_preferences ?? {}),
    ai_assumptions: deepMerge(current?.ai_assumptions ?? {}, update.ai_assumptions ?? {}),
    decision_history: clampDecisionHistory(
      [
        ...(Array.isArray(current?.decision_history) ? current!.decision_history : []),
        ...(update.decision_event ? [update.decision_event] : []),
      ],
      50
    ),
  };

  const up = await supabase
    .from('business_intelligence_memory')
    .upsert(next as any, { onConflict: 'business_id' })
    .select('*')
    .single();

  if (up.error) return current;
  return up.data as any;
}

export function formatMemoryForPrompt(memory: BusinessIntelligenceMemory | null): string {
  if (!memory) return '';

  // Keep it compact so we don't blow token budgets.
  const dna = memory.business_dna ?? {};
  const prefs = memory.owner_preferences ?? {};
  const assumptions = memory.ai_assumptions ?? {};
  const history = Array.isArray(memory.decision_history) ? memory.decision_history.slice(-10) : [];

  return `RevGuard Memory Engine v1 (business-scoped):
- business_dna: ${JSON.stringify(dna).slice(0, 1200)}
- owner_preferences: ${JSON.stringify(prefs).slice(0, 1200)}
- ai_assumptions: ${JSON.stringify(assumptions).slice(0, 1200)}
- decision_history (latest): ${JSON.stringify(history).slice(0, 1200)}
Rules:
- Use this ONLY to tailor tone/priorities. Never force actions.
- If memory conflicts with the user's latest request, follow the latest request.
`.trim();
}


