import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

/**
 * Security headers applied to every response.
 *
 * NOTE (Phase 1): Content-Security-Policy is deliberately NOT set here yet.
 * A correct CSP for this app needs per-request nonces, which are generated in
 * middleware once there is real UI to protect. Shipping a permissive
 * placeholder CSP now would be worse than none, because it would look done.
 * CSP lands in Phase 12 (security hardening) per docs/10-roadmap.md, and is
 * tracked as an open item in docs/adr/0009-security-baseline.md.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@kurdora/brand', '@kurdora/i18n'],
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
