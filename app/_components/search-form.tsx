import { useTranslations } from 'next-intl';

/**
 * Site search.
 *
 * A plain GET form. It works with JavaScript disabled, produces a shareable
 * URL, and needs no client bundle — which is the right default for the single
 * most-used control on a marketplace.
 *
 * The locale prefix is part of the action because a native form submit does
 * not go through next-intl's router.
 */
export function SearchForm({
  locale,
  defaultValue = '',
  size = 'md',
}: {
  locale: string;
  defaultValue?: string;
  size?: 'md' | 'lg';
}) {
  const t = useTranslations('search');
  const isLarge = size === 'lg';

  return (
    <form
      action={`/${locale}/search`}
      method="get"
      role="search"
      className={`flex w-full ${isLarge ? 'gap-2' : 'gap-1.5'}`}
    >
      <label htmlFor="site-search" className="sr-only">
        {t('label')}
      </label>
      <input
        id="site-search"
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={t('placeholder')}
        autoComplete="off"
        maxLength={120}
        dir="auto"
        className={`border-border bg-surface focus:border-accent min-w-0 flex-1 rounded-md border ps-3 pe-3 ${
          isLarge ? 'py-3 text-base' : 'py-2 text-sm'
        }`}
      />
      <button
        type="submit"
        className={`bg-accent text-accent-ink hover:bg-accent-strong rounded-md font-medium transition-colors ${
          isLarge ? 'px-6 py-3' : 'px-4 py-2 text-sm'
        }`}
      >
        {t('submit')}
      </button>
    </form>
  );
}
