import { redirect } from 'next/navigation';

/**
 * SCR-001 will live here: value proposition, login, and the demo dashboard shown before a Meta
 * account is connected. Until that screen exists, the root goes straight to the demo dashboard so
 * the vertical slice is reachable.
 */
export default function HomePage() {
  redirect('/dashboard');
}
