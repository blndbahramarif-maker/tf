import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { logoutAction } from '../(auth)/actions';

export const dynamic = 'force-dynamic';

/**
 * Dashboard shell and authentication gate.
 *
 * The gate is here rather than in each page so a new page cannot be added
 * without it. It is not the ONLY check — every action re-verifies, because a
 * Server Action is reachable directly and does not go through this layout.
 *
 * When the access cookie has expired but a refresh token survives, the reader
 * is bounced through the refresh route (a Server Component cannot write
 * cookies) and comes straight back. `next` carries them to the page they
 * asked for, and is validated server-side before being used.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();

  if (state.kind === 'refreshable') {
    redirect(`/api/v1/auth/session?next=${encodeURIComponent(`/${locale}/dashboard`)}`);
  }
  if (state.kind === 'suspended') {
    // A suspended account is signed out of the dashboard immediately, not at
    // the next token expiry.
    redirect(`/${locale}/login?suspended=1`);
  }
  if (state.kind !== 'authenticated') {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/dashboard`)}`);
  }

  const t = await getTranslations('dashboard.nav');
  const { principal, csrfToken } = state.session;

  const links = [
    { href: '/dashboard', label: t('overview') },
    { href: '/dashboard/listings', label: t('listings') },
    { href: '/dashboard/messages', label: t('messages') },
    { href: '/dashboard/offers', label: t('offers') },
    { href: '/dashboard/payouts', label: t('payouts') },
    { href: '/dashboard/profile', label: t('profile') },
    { href: '/dashboard/security', label: t('security') },
  ] as const;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:px-8">
      <aside className="lg:sticky lg:top-32 lg:self-start">
        <nav aria-label={t('sectionLabel')}>
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="hover:bg-surface-muted block rounded-md px-3 py-2 text-sm font-medium transition-colors"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <form action={logoutAction} className="mt-6">
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            className="text-ink-muted hover:text-ink text-sm underline underline-offset-4"
          >
            {t('signOut')}
          </button>
        </form>

        {principal.emailVerified ? null : (
          <p className="border-warning/40 bg-warning-soft mt-6 rounded-md border p-3 text-xs">
            {t('verifyEmailNotice')}
          </p>
        )}
      </aside>

      <main id="main">{children}</main>

      {/*
        The CSRF token is rendered into the page so forms can submit it. It is
        NOT a credential: on its own it authenticates nobody, and it is bound by
        HMAC to this session so it is useless in any other. The access and
        refresh tokens are never rendered anywhere.
      */}
      <span hidden data-testid="csrf-present">
        {csrfToken === '' ? 'no' : 'yes'}
      </span>
    </div>
  );
}
