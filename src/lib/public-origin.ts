import { siteConfig } from '@/config/site';

// Behind the Coolify proxy `request.url` carries the internal host
// (localhost:3000), so redirects must be built from the forwarded headers.
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (host) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    return `${proto}://${host}`;
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (isLocal && process.env.NODE_ENV !== 'production') return url.origin;
  return isLocal ? siteConfig.url : url.origin;
}
