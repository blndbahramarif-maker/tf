/**
 * Listing image.
 *
 * Deliberately a plain `<img>` rather than `next/image`.
 *
 * Our upload pipeline already re-encodes every upload to WebP at three fixed
 * widths (`src/infra/images/processor.ts`), strips EXIF and destroys polyglot
 * payloads. Routing those derivatives through Next's optimiser would re-decode
 * and re-encode images a second time at request scale, for no quality gain,
 * and would put an image proxy in front of URLs we already control. Building
 * `srcSet` from the variants we generated ourselves gives the same responsive
 * selection with none of that.
 *
 * `alt` is always rendered — an empty string where the image is decorative, a
 * seller-supplied description where there is one. It is never omitted.
 */
/* eslint-disable @next/next/no-img-element */

const VARIANT_WIDTHS: Readonly<Record<string, number>> = {
  thumb: 320,
  card: 720,
  full: 1600,
};

function buildSrcSet(variants: Readonly<Record<string, string>>): string | undefined {
  const entries = Object.entries(variants)
    .filter(([name]) => name in VARIANT_WIDTHS)
    .sort((a, b) => VARIANT_WIDTHS[a[0]]! - VARIANT_WIDTHS[b[0]]!)
    .map(([name, url]) => `${url} ${VARIANT_WIDTHS[name]}w`);

  return entries.length > 0 ? entries.join(', ') : undefined;
}

export function ListingImage({
  url,
  variants,
  alt,
  width,
  height,
  sizes,
  className,
  priority = false,
}: {
  url: string;
  variants?: Readonly<Record<string, string>>;
  alt: string;
  width?: number | null;
  height?: number | null;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      src={variants?.card ?? url}
      srcSet={variants ? buildSrcSet(variants) : undefined}
      sizes={sizes}
      alt={alt}
      width={width ?? undefined}
      height={height ?? undefined}
      // Above-the-fold images load eagerly; everything else defers. The hero
      // image of a listing page is the LCP element.
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      className={className}
    />
  );
}

/** Placeholder for a listing with no approved image yet. */
export function ImagePlaceholder({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={`bg-surface-sunken text-ink-muted flex items-center justify-center text-xs ${className ?? ''}`}
      role="img"
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        className="size-8 opacity-60"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="m21 16-5-5-5 5-3-3-5 5" />
      </svg>
    </div>
  );
}
