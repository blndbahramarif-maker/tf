import { useTranslations } from 'next-intl';
import type { SearchResultItem } from '@/domain/ports/search';
import { ListingCard } from './listing-card';

/**
 * Results grid.
 *
 * Desktop-first: four columns on a large screen, collapsing to two and then
 * one. `auto-rows-fr` keeps cards in a row the same height whatever the title
 * length, which is what stops a grid of mixed-language titles looking ragged.
 */
export function ListingGrid({
  items,
  locale,
  emptyMessage,
}: {
  items: readonly SearchResultItem[];
  locale: string;
  emptyMessage?: string;
}) {
  const t = useTranslations('search');

  if (items.length === 0) {
    return (
      <p className="border-border text-ink-muted rounded-[--radius-card] border border-dashed px-6 py-16 text-center text-sm">
        {emptyMessage ?? t('noResults')}
      </p>
    );
  }

  return (
    <ul className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item, index) => (
        <li key={item.id} className="flex">
          {/* The first row is above the fold on a desktop viewport. */}
          <ListingCard item={item} locale={locale} priority={index < 4} />
        </li>
      ))}
    </ul>
  );
}
