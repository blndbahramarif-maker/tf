import { useTranslations } from 'next-intl';
import { LISTING_CONDITIONS } from '@/shared/listing-contract';
import type { Facets } from '@/domain/ports/search';
import type { FilterableAttribute } from '@/infra/catalogue/read-model';
import {
  ATTRIBUTE_MAX_PREFIX,
  ATTRIBUTE_MIN_PREFIX,
  ATTRIBUTE_PREFIX,
  PRICE_FROM_PARAM,
  PRICE_TO_PARAM,
  type PageSearchParams,
} from '@/lib/search/params';

/**
 * Category filter panel.
 *
 * Entirely server-rendered and submitted as a GET form: filters end up in the
 * URL, so a filtered view is shareable, bookmarkable and crawlable, and the
 * panel works with JavaScript disabled.
 *
 * WHICH filters appear is decided by the database. An attribute shows up here
 * because an admin marked it `is_filterable`, and its control type follows its
 * `dataType`. There is no list of category names anywhere in this file, and
 * adding a filter to a category needs no deploy.
 */
export function FilterPanel({
  locale,
  categorySlug,
  attributes,
  facets,
  params,
  currency,
}: {
  locale: string;
  categorySlug: string;
  attributes: readonly FilterableAttribute[];
  facets: Facets | null;
  params: PageSearchParams;
  currency: string;
}) {
  const t = useTranslations('filters');
  const tListing = useTranslations('listing');

  const selected = (key: string): string[] => {
    const value = params[key];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  };

  const single = (key: string): string => selected(key)[0] ?? '';

  return (
    <form
      action={`/${locale}/c/${categorySlug}`}
      method="get"
      className="border-border bg-surface flex flex-col gap-6 rounded-[--radius-card] border p-5"
      aria-label={t('heading')}
    >
      {/* Free text survives a filter change rather than being silently dropped. */}
      {single('q') === '' ? null : <input type="hidden" name="q" value={single('q')} />}
      {single('sort') === '' ? null : <input type="hidden" name="sort" value={single('sort')} />}

      <h2 className="text-sm font-semibold tracking-wide uppercase">{t('heading')}</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t('priceRange', { currency })}</legend>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="filter-price-from">
            {t('priceFrom')}
          </label>
          <input
            id="filter-price-from"
            type="text"
            inputMode="decimal"
            name={PRICE_FROM_PARAM}
            defaultValue={single(PRICE_FROM_PARAM)}
            placeholder={t('priceFrom')}
            className="border-border w-full rounded-md border px-2 py-1.5 text-sm"
          />
          <span className="text-ink-muted text-sm" aria-hidden="true">
            –
          </span>
          <label className="sr-only" htmlFor="filter-price-to">
            {t('priceTo')}
          </label>
          <input
            id="filter-price-to"
            type="text"
            inputMode="decimal"
            name={PRICE_TO_PARAM}
            defaultValue={single(PRICE_TO_PARAM)}
            placeholder={t('priceTo')}
            className="border-border w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="filter-condition" className="text-sm font-medium">
          {t('condition')}
        </label>
        <select
          id="filter-condition"
          name="condition"
          defaultValue={single('condition')}
          className="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="">{t('anyCondition')}</option>
          {LISTING_CONDITIONS.filter((value) => value !== 'NOT_APPLICABLE').map((value) => (
            <option key={value} value={value}>
              {tListing(`condition.${value}`)}
            </option>
          ))}
        </select>
      </div>

      {attributes.map((attribute) => (
        <AttributeFilter
          key={attribute.key}
          attribute={attribute}
          counts={facets?.attributes[attribute.key] ?? null}
          selectedValues={selected(`${ATTRIBUTE_PREFIX}${attribute.key}`)}
          minValue={single(`${ATTRIBUTE_MIN_PREFIX}${attribute.key}`)}
          maxValue={single(`${ATTRIBUTE_MAX_PREFIX}${attribute.key}`)}
          anyLabel={t('any')}
          fromLabel={t('from')}
          toLabel={t('to')}
        />
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="bg-accent text-accent-ink hover:bg-accent-strong flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors"
        >
          {t('apply')}
        </button>
        <a
          href={`/${locale}/c/${categorySlug}`}
          className="text-ink-muted hover:text-ink text-sm underline"
        >
          {t('clear')}
        </a>
      </div>
    </form>
  );
}

function AttributeFilter({
  attribute,
  counts,
  selectedValues,
  minValue,
  maxValue,
  anyLabel,
  fromLabel,
  toLabel,
}: {
  attribute: FilterableAttribute;
  counts: readonly { value: string; count: number }[] | null;
  selectedValues: readonly string[];
  minValue: string;
  maxValue: string;
  anyLabel: string;
  fromLabel: string;
  toLabel: string;
}) {
  const heading =
    attribute.unit === null ? attribute.label : `${attribute.label} (${attribute.unit})`;

  // Numeric attributes get a range; everything enumerable gets checkboxes.
  // The control follows the DATA TYPE, never the attribute's name.
  if (attribute.dataType === 'INTEGER' || attribute.dataType === 'NUMBER') {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{heading}</legend>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`filter-${attribute.key}-min`}>
            {`${heading} — ${fromLabel}`}
          </label>
          <input
            id={`filter-${attribute.key}-min`}
            type="number"
            inputMode="numeric"
            name={`${ATTRIBUTE_MIN_PREFIX}${attribute.key}`}
            defaultValue={minValue}
            placeholder={fromLabel}
            className="border-border w-full rounded-md border px-2 py-1.5 text-sm"
          />
          <span className="text-ink-muted text-sm" aria-hidden="true">
            –
          </span>
          <label className="sr-only" htmlFor={`filter-${attribute.key}-max`}>
            {`${heading} — ${toLabel}`}
          </label>
          <input
            id={`filter-${attribute.key}-max`}
            type="number"
            inputMode="numeric"
            name={`${ATTRIBUTE_MAX_PREFIX}${attribute.key}`}
            defaultValue={maxValue}
            placeholder={toLabel}
            className="border-border w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </div>
      </fieldset>
    );
  }

  if (attribute.options.length > 0) {
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-2 text-sm font-medium">{heading}</legend>
        {attribute.options.map((option) => {
          const count = counts?.find((entry) => entry.value === option.value)?.count;
          return (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`${ATTRIBUTE_PREFIX}${attribute.key}`}
                value={option.value}
                defaultChecked={selectedValues.includes(option.value)}
                className="accent-accent size-4"
              />
              <span className="flex-1">{option.label}</span>
              {count === undefined ? null : (
                <span className="text-ink-muted text-xs tabular-nums">{count}</span>
              )}
            </label>
          );
        })}
      </fieldset>
    );
  }

  // Free-text attribute: an exact-match box, with observed values as hints.
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`filter-${attribute.key}`} className="text-sm font-medium">
        {heading}
      </label>
      <input
        id={`filter-${attribute.key}`}
        type="text"
        name={`${ATTRIBUTE_PREFIX}${attribute.key}`}
        defaultValue={selectedValues[0] ?? ''}
        placeholder={anyLabel}
        list={counts === null ? undefined : `filter-${attribute.key}-options`}
        dir="auto"
        className="border-border rounded-md border px-2 py-1.5 text-sm"
      />
      {counts === null ? null : (
        <datalist id={`filter-${attribute.key}-options`}>
          {counts.map((entry) => (
            <option key={entry.value} value={entry.value} />
          ))}
        </datalist>
      )}
    </div>
  );
}
