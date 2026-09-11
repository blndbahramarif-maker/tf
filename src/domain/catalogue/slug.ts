/**
 * SEO slug generation.
 *
 * Unicode-aware: Sorani and Arabic titles keep their own letters rather than
 * being stripped to nothing. A URL ends up percent-encoded by the browser,
 * which search engines handle, and the listing id is always present in the
 * path so a renamed listing never 404s and never loses link equity.
 *
 * See docs/09-i18n-rtl.md.
 */

const MAX_SLUG_LENGTH = 80;

/**
 * Combining marks are removed for LATIN text only (café → cafe), because Latin
 * diacritics are decorative in a URL. Arabic-script diacritics are NOT stripped
 * by this: the letters themselves are `\p{L}` and survive.
 */
function stripLatinDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function slugify(input: string): string {
  const cleaned = stripLatinDiacritics(input.trim().toLowerCase())
    // Keep letters and numbers in ANY script; everything else becomes a break.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  if (cleaned.length <= MAX_SLUG_LENGTH) return cleaned;

  // Truncate on a word boundary so the slug does not end mid-word.
  const truncated = cleaned.slice(0, MAX_SLUG_LENGTH);
  const lastBreak = truncated.lastIndexOf('-');
  return (lastBreak > MAX_SLUG_LENGTH / 2 ? truncated.slice(0, lastBreak) : truncated).replace(
    /-+$/,
    '',
  );
}

/**
 * A slug that is safe to put in a path even when the title produced nothing
 * usable (a title of only punctuation, or only emoji).
 */
export function slugifyWithFallback(input: string, fallback: string): string {
  const slug = slugify(input);
  return slug.length > 0 ? slug : fallback;
}

/**
 * Canonical listing path.
 *
 * The id comes FIRST after the segment so the route can resolve a listing
 * without parsing the slug at all — the slug is decoration for humans and
 * search engines, and may change freely.
 */
export function listingPath(locale: string, id: string, slug: string): string {
  const suffix = slug.length > 0 ? `/${encodeURIComponent(slug)}` : '';
  return `/${locale}/listing/${id}${suffix}`;
}

export function categoryPath(locale: string, categorySlug: string): string {
  return `/${locale}/c/${encodeURIComponent(categorySlug)}`;
}

/** True when the request's slug matches canonical — used to 301 to the right URL. */
export function isCanonicalSlug(requested: string | undefined, canonical: string): boolean {
  return (requested ?? '') === canonical;
}
