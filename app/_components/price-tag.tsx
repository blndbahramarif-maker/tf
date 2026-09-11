import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format/money';

/**
 * Renders a listing price.
 *
 * Price TYPE is data, not a category name: a listing with no amount is not an
 * error, it is a `FREE`, `ON_REQUEST` or unpriced listing and each reads
 * differently to a buyer. The component therefore never invents "£0.00".
 */
export function PriceTag({
  priceMinor,
  currency,
  priceType,
  locale,
  size = 'md',
}: {
  priceMinor: bigint | null;
  currency: string;
  priceType: string;
  locale: string;
  size?: 'md' | 'lg';
}) {
  const t = useTranslations('listing');
  const classes = size === 'lg' ? 'text-3xl font-semibold' : 'text-lg font-semibold';

  if (priceType === 'FREE') {
    return <p className={`${classes} text-accent-strong`}>{t('price.free')}</p>;
  }

  if (priceMinor === null) {
    return <p className={`${classes} text-ink-muted`}>{t('price.onRequest')}</p>;
  }

  return (
    <p className={classes}>
      <span>{formatMoney(priceMinor, currency, locale)}</span>
      {priceType === 'NEGOTIABLE' ? (
        <span className="text-ink-muted ms-2 text-sm font-normal">{t('price.negotiable')}</span>
      ) : null}
    </p>
  );
}
