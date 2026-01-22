import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import SignupClient from './SignupClient';

export default async function SignupPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('rg_at')?.value ?? null;
  if (token) {
    // eslint-disable-next-line no-console
    console.log('SIGNUP_PAGE_REDIRECT', { reason: 'has_rg_at', to: '/dashboard' });
    redirect('/dashboard');
  }
  return <SignupClient />;
}
