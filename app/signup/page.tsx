import SignupClient from './SignupClient';

export default async function SignupPage() {
  // Never redirect based on rg_at cookie alone (can be stale and cause loops).
  return <SignupClient />;
}
