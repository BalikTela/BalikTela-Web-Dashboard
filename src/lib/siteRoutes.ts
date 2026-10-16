import { readAuthLink } from './authLinks.js';

export function resolveSiteRoute(href: string): 'home' | 'workspace' | 'not-found' {
  const url = new URL(href);
  // Existing email links can target the root URL, so resolve them before the public homepage.
  if (readAuthLink(href).isCallback) return 'workspace';
  if (url.searchParams.get('auth') === 'register') return 'workspace';
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'home';
  if (['/login', '/dashboard', '/auth/callback'].some(route => path === route || path.startsWith(`${route}/`))) return 'workspace';
  return 'not-found';
}

export function mobileAppUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
