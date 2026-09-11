import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import type { SearchResultItem } from '@/domain/ports/search';
import { Badge } from './badge';
import { ImagePlaceholder, ListingImage } from './listing-image';
import { PriceTag } from './price-tag';

/**
 * One result in a grid.
 *
 * The whole card is a single link, so the accessible name is the title rather
 * than a repeated "view listing". Seller text carries `dir="auto"`: a Sorani
 * title inside an English page must read right-to-left on its own without
 * mirroring the card around it.
 */
export function ListingCard({
  item,
  locale,
  priority = false,
}: {
  item: SearchResultItem;
  locale: string;
  priority?: boolean;
}) {
  const t = useTranslations('listing');

  const priceMinor = item.priceMinor === null ? null : BigInt(item.priceMinor);

  return (
    <article className="border-border bg-surface focus-within:border-accent hover:border-border-strong group relative flex w-full flex-col overflow-hidden rounded-[--radius-card] border transition-colors">
      <div className="bg-surface-sunken aspect-[4/3] w-full overflow-hidden">
        {item.primaryImageUrl === null ? (
          <ImagePlaceholder label={t('noImage')} className="size-full" />
        ) : (
          <ListingImage
            url={item.primaryImageUrl}
            alt=""
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            priority={priority}
            className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-sm leading-snug font-medium">
          <Link
            href={`/listing/${item.id}/${item.slug}`}
            dir="auto"
            className="content-text after:absolute after:inset-0 after:content-['']"
          >
            {item.title}
          </Link>
        </h3>

        <PriceTag
          priceMinor={priceMinor}
          currency={item.currency}
          priceType={item.priceType}
          locale={locale}
        />

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {item.condition !== 'NOT_APPLICABLE' ? (
            <Badge>{t(`condition.${item.condition}`)}</Badge>
          ) : null}
          {item.cityName === null ? null : (
            <span className="text-ink-muted text-xs" dir="auto">
              {item.cityName}
            </span>
          )}
        </div>

        <p className="text-ink-muted truncate text-xs" dir="auto">
          {item.sellerDisplayName}
        </p>
      </div>
    </article>
  );
}
