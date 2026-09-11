import { useTranslations } from 'next-intl';
import { brand } from '@kurdora/brand';

/**
 * Site footer.
 *
 * The legal entity line is read from brand configuration rather than typed in,
 * so incorporation details land in one place. The company number is empty
 * until Companies House registration completes, and is omitted rather than
 * rendered blank.
 */
export function SiteFooter({ locale }: { locale: string }) {
  const t = useTranslations('footer');
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-border bg-surface-muted mt-16 border-t">
      <div className="text-ink-muted mx-auto max-w-7xl px-4 py-10 text-sm lg:px-8">
        <p className="text-ink font-medium">{t('tagline', { brandName: brand.name })}</p>

        <p className="mt-4">
          {t('legalLine', {
            year: String(year),
            brandName: brand.name,
            legalName: brand.legalEntity.name,
            jurisdiction: brand.legalEntity.jurisdiction,
          })}
        </p>

        {brand.legalEntity.companyNumber === '' ? null : (
          <p className="mt-1">
            {t('companyNumber', { companyNumber: brand.legalEntity.companyNumber })}
          </p>
        )}

        <p className="mt-4">
          <a href={`mailto:${brand.support.email}`} className="hover:text-ink underline">
            {t('contact')}
          </a>
        </p>

        <p className="mt-6 text-xs" lang={locale}>
          {t('phaseNotice')}
        </p>
      </div>
    </footer>
  );
}
