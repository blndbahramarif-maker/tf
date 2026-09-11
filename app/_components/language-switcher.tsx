'use client';

import { ENABLED_LOCALES, getLocale } from '@kurdora/i18n';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/navigation';

/**
 * Language switcher.
 *
 * Only ENABLED locales are offered. Kurmanji and Arabic stay routable so their
 * URLs resolve, but they are not advertised until a native speaker has
 * reviewed the catalogue (docs/09-i18n-rtl.md).
 *
 * A client component purely because it needs the current pathname to keep the
 * reader on the page they are on. Each option is still a real anchor carrying
 * `hreflang`, so it is crawlable and works without JavaScript.
 */
export function LanguageSwitcher({ current }: { current: string }) {
  const t = useTranslations('common');
  const pathname = usePathname();

  return (
    <nav aria-label={t('languageLabel')} className="flex items-center gap-1">
      {ENABLED_LOCALES.map((code) => {
        const definition = getLocale(code);
        const isCurrent = code === current;
        return (
          <Link
            key={code}
            href={pathname}
            locale={code}
            hrefLang={code}
            lang={code}
            aria-current={isCurrent ? 'true' : undefined}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              isCurrent
                ? 'bg-surface-sunken text-ink'
                : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
            }`}
          >
            {definition.nativeName}
          </Link>
        );
      })}
    </nav>
  );
}
