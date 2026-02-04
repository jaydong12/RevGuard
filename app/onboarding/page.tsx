import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/server/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function OnboardingIndex() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user ?? null;
  if (!user?.id) {
    redirect('/check-email?next=/onboarding/business');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_complete,onboarding_step')
    .eq('id', user.id)
    .maybeSingle();

  const complete = Boolean((profile as any)?.onboarding_complete);
  if (complete) redirect('/dashboard');

  const stepRaw = String((profile as any)?.onboarding_step ?? 'business').trim().toLowerCase();
  const step = stepRaw === 'profile' || stepRaw === 'banking' ? stepRaw : 'business';
  redirect(`/onboarding/${step}`);
}