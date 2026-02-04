import LoginClient from './LoginClient';

export default async function LoginPage() {
  // Never redirect based on rg_at cookie alone (can be stale and cause loops).
  return <LoginClient />;
}
