// Shared helper for write paths that must always be business-scoped.
// Uses owner_id = auth.uid() semantics (via the logged-in user).
//
// NOTE: Callers should ensure RLS policies on public.business allow owner-scoped
// select/insert (see `supabase/rls_business.sql`).

export async function getOrCreateBusinessId(supabase: any): Promise<string> {
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) throw new Error('Not signed in');

  const { data: biz, error: bErr } = await supabase
    .from('business')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (bErr) throw bErr;

  if (biz?.id) return biz.id;

  const { data: created, error: cErr } = await supabase
    .from('business')
    .insert({ owner_id: user.id, name: 'My Business' })
    .select('id')
    .single();

  if (cErr || !created?.id) throw cErr ?? new Error('Could not create business');
  return created.id;
}


