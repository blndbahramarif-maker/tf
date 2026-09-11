import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { brand } from '@kurdora/brand';
import { listingPath } from '@/domain/catalogue/slug';
import { loadPublicListing, type PublicListing } from '@/infra/catalogue/read-model';
import { isUuid } from '@/lib/api/guards';
import { formatDate } from '@/lib/format/money';
import { alternatesFor, canonicalUrl } from '@/lib/seo/urls';
import { formatMinorAsDecimal } from '@/shared/money';
import { Badge } from '../../../../_components/badge';
import { Breadcrumbs } from '../../../../_components/breadcrumbs';
import { JsonLd } from '../../../../_components/json-ld';
import { ImagePlaceholder, ListingImage } from '../../../../_components/listing-image';
import { PriceTag } from '../../../../_components/price-tag';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string; id: string; slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Resolves the listing for a request.
 *
 * The id is validated as a UUID BEFORE it reaches the database. An
 * unparseable id makes Postgres raise, which would surface as a 500 carrying
 * a database error message; here it is simply a 404, exactly like an id that
 * does not exist (CLAUDE.md, non-negotiable 16).
 */
async function resolve(locale: string, id: string): Promise<PublicListing | null> {
  if (!isUuid(id)) return null;
  return loadPublicListing(id, locale);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isLocale(locale)) return {};

  const listing = await resolve(locale, id);
  if (listing === null) return {};

  const description = listing.description.replace(/\s+/g, ' ').slice(0, 300);
  const image = listing.images[0];

  return {
    title: listing.title,
    description,
    alternates: alternatesFor(`/listing/${id}/${listing.slug}`, locale),
    openGraph: {
      type: 'website',
      title: listing.title,
      description,
      url: canonicalUrl(listingPath(locale, id, listing.slug)),
      siteName: brand.name,
      locale,
      images: image === undefined ? undefined : [{ url: image.variants.full ?? image.url }],
    },
  };
}

/**
 * Listing detail.
 *
 * Only ACTIVE listings render here. A draft, paused or rejected listing is
 * genuinely absent to an anonymous reader — its owner reaches it through the
 * authenticated API, where the ownership guard applies.
 *
 * The canonical URL carries the slug; a request with a stale or missing slug
 * is redirected permanently to the canonical one, so a renamed listing keeps
 * its links and its ranking rather than accumulating duplicates.
 */
export default async function ListingPage({ params, searchParams }: PageProps) {
  const { locale, id, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const listing = await resolve(locale, id);
  if (listing === null) notFound();

  const requestedSlug = slug?.join('/') ?? '';
  if (requestedSlug !== listing.slug) {
    permanentRedirect(listingPath(locale, listing.id, listing.slug));
  }

  const t = await getTranslations('listing');
  const tNav = await getTranslations('nav');

  const resolvedSearchParams = await searchParams;
  const requestedImage = Number.parseInt(
    typeof resolvedSearchParams.image === 'string' ? resolvedSearchParams.image : '',
    10,
  );
  const activeIndex =
    Number.isInteger(requestedImage) &&
    requestedImage >= 0 &&
    requestedImage < listing.images.length
      ? requestedImage
      : 0;
  const activeImage = listing.images[activeIndex];

  const canonical = listingPath(locale, listing.id, listing.slug);

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <Breadcrumbs
        crumbs={[
          { label: tNav('home'), href: '/' },
          { label: listing.category.name, href: `/c/${listing.category.slug}` },
          { label: listing.title },
        ]}
      />

      <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <div className="bg-surface-sunken aspect-[4/3] w-full overflow-hidden rounded-[--radius-card]">
            {activeImage === undefined ? (
              <ImagePlaceholder label={t('noImage')} className="size-full" />
            ) : (
              <ListingImage
                url={activeImage.url}
                variants={activeImage.variants}
                alt={activeImage.altText ?? ''}
                width={activeImage.width}
                height={activeImage.height}
                sizes="(max-width: 1024px) 100vw, 60vw"
                priority
                className="size-full object-contain"
              />
            )}
          </div>

          {listing.images.length < 2 ? null : (
            /*
             * Thumbnails are links, not buttons: switching image is a URL
             * change, which means it works without JavaScript, is shareable,
             * and each image is individually reachable by a crawler.
             */
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('gallery')}>
              {listing.images.map((image, index) => (
                <li key={image.url}>
                  <a
                    href={`${canonical}${index === 0 ? '' : `?image=${index}`}`}
                    aria-current={index === activeIndex ? 'true' : undefined}
                    aria-label={t('imageNumber', { number: index + 1 })}
                    className={`block size-20 overflow-hidden rounded-md border-2 transition-colors ${
                      index === activeIndex ? 'border-accent' : 'border-transparent'
                    }`}
                  >
                    <ListingImage
                      url={image.variants.thumb ?? image.url}
                      alt=""
                      sizes="80px"
                      className="size-full object-cover"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}

          <section aria-labelledby="description-heading" className="mt-10">
            <h2 id="description-heading" className="text-lg font-semibold">
              {t('descriptionHeading')}
            </h2>
            {/*
             * Seller text is rendered as TEXT, never as HTML. React escapes it;
             * `whitespace-pre-line` preserves the seller's paragraphs without
             * giving them any markup capability. `dir="auto"` lets a Sorani
             * description read right-to-left inside an English page.
             */}
            <p
              className="content-text mt-3 text-sm leading-relaxed whitespace-pre-line"
              dir="auto"
              lang={listing.contentLocale}
            >
              {listing.description}
            </p>
          </section>

          {listing.attributes.length === 0 ? null : (
            <section aria-labelledby="details-heading" className="mt-10">
              <h2 id="details-heading" className="text-lg font-semibold">
                {t('detailsHeading')}
              </h2>
              <dl className="border-border mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-[--radius-card] border sm:grid-cols-2">
                {listing.attributes.map((attribute) => (
                  <div
                    key={attribute.key}
                    className="bg-surface flex justify-between gap-4 px-4 py-3"
                  >
                    <dt className="text-ink-muted text-sm">{attribute.label}</dt>
                    <dd className="text-end text-sm font-medium" dir="auto">
                      {attribute.unit === null
                        ? attribute.displayValue
                        : `${attribute.displayValue} ${attribute.unit}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="border-border bg-surface rounded-[--radius-card] border p-6">
            <h1
              className="content-text text-xl font-semibold text-balance"
              dir="auto"
              lang={listing.contentLocale}
            >
              {listing.title}
            </h1>

            <div className="mt-4">
              <PriceTag
                priceMinor={listing.priceMinor}
                currency={listing.currency}
                priceType={listing.priceType}
                locale={locale}
                size="lg"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {listing.condition === 'NOT_APPLICABLE' ? null : (
                <Badge>{t(`condition.${listing.condition}`)}</Badge>
              )}
              {listing.quantity > 1 ? (
                <Badge>{t('quantity', { count: listing.quantity })}</Badge>
              ) : null}
              {listing.seller.isVerified ? (
                <Badge tone="accent">{t('verifiedSeller')}</Badge>
              ) : null}
            </div>

            <dl className="text-ink-muted mt-6 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt>{t('location')}</dt>
                <dd className="text-ink text-end" dir="auto">
                  {listing.cityName ?? listing.countryCode}
                </dd>
              </div>
              {listing.publishedAt === null ? null : (
                <div className="flex justify-between gap-4">
                  <dt>{t('published')}</dt>
                  <dd className="text-ink text-end">{formatDate(listing.publishedAt, locale)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt>{t('seller')}</dt>
                <dd className="text-ink text-end" dir="auto">
                  {listing.seller.displayName}
                </dd>
              </div>
            </dl>

            {/*
             * Contacting a seller is Phase 6 (messaging) and paying is Phase 7.
             * Neither exists, so neither is offered here: a button that does
             * nothing is worse than an honest statement of what is available.
             * The notice is keyed by the category's transaction flow, which is
             * data on the category row, not a name this file knows.
             */}
            <p className="border-border text-ink-muted mt-6 border-t pt-4 text-sm">
              {t(`contactNotice.${listing.category.transactionFlow}`)}
            </p>
          </div>
        </aside>
      </div>

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: listing.title,
          description: listing.description.slice(0, 5000),
          inLanguage: listing.contentLocale,
          url: canonicalUrl(canonical),
          image: listing.images.map((image) => image.variants.full ?? image.url),
          category: listing.category.name,
          ...(listing.condition === 'NOT_APPLICABLE'
            ? {}
            : { itemCondition: schemaCondition(listing.condition) }),
          ...(listing.priceMinor === null
            ? {}
            : {
                offers: {
                  '@type': 'Offer',
                  // Schema.org wants a decimal string. It is produced from the
                  // bigint minor units, never through a float.
                  price: formatMinorAsDecimal(listing.priceMinor, listing.currency),
                  priceCurrency: listing.currency,
                  availability: 'https://schema.org/InStock',
                  url: canonicalUrl(canonical),
                  seller: { '@type': 'Organization', name: listing.seller.displayName },
                },
              }),
        }}
      />

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { name: tNav('home'), path: `/${locale}` },
            { name: listing.category.name, path: `/${locale}/c/${listing.category.slug}` },
            { name: listing.title, path: canonical },
          ].map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.name,
            item: canonicalUrl(crumb.path),
          })),
        }}
      />
    </main>
  );
}

/** Maps our condition enum onto schema.org's fixed vocabulary. */
function schemaCondition(condition: string): string {
  const map: Readonly<Record<string, string>> = {
    NEW: 'https://schema.org/NewCondition',
    LIKE_NEW: 'https://schema.org/UsedCondition',
    GOOD: 'https://schema.org/UsedCondition',
    FAIR: 'https://schema.org/UsedCondition',
    FOR_PARTS: 'https://schema.org/DamagedCondition',
  };
  return map[condition] ?? 'https://schema.org/UsedCondition';
}
