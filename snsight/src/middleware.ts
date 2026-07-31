import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Route protection.
 *
 * Deliberately only checks for the presence of a session cookie. Middleware runs on the edge without
 * database access, so it cannot know whether a session is revoked or expired - and a middleware that
 * pretended to know would be the only check anyone remembered to write.
 *
 * The real decision happens in the page or action through `getAuthState`, which reads the session row.
 * This exists to redirect obviously-unauthenticated visitors without a database round trip.
 */

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/demo'];
const PUBLIC_PREFIXES = ['/_next/', '/api/auth/', '/favicon', '/robots.txt', '/preview/'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const hasCookie = request.cookies.has(SESSION_COOKIE.name);
  if (hasCookie) return NextResponse.next();

  const login = new URL('/login', request.url);
  // Preserved so a shared link survives the sign-in detour.
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
