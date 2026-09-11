import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';
import { Link } from '@/lib/i18n/navigation';
import { readSessionState } from '@/lib/auth/server-session';
import { loadOwnedListingDetail } from '@/infra/catalogue/dashboard-read-model';
import { loadAttributeDefinitions, loadCategoryBySlug } from '@/infra/catalogue/category-service';
import { prisma } from '@/infra/db/client';
import { isUuid } from '@/lib/api/guards';
import { listingPath } from '@/domain/catalogue/slug';
import { EDITABLE_STATUSES } from '@/domain/catalogue/listing-status';
import { Badge } from '../../../../_components/badge';
import { FormError } from '../../../../_components/form-field';
import { ImagePlaceholder, ListingImage } from '../../../../_components/listing-image';
import {
  DeleteImageForm,
  EditListingForm,
  TransitionForm,
  type AttributeInput,
} from '../../dashboard-forms';

export const dynamic = 'force-dynamic';

/**
 * Edit one listing.
 *
 * The id comes from the URL, so it is a claim. `loadOwnedListingDetail` scopes
 * the query by the owner's user id from the session, so a listing belonging to
 * someone else simply does not come back — and the page 404s, identically to a
 * listing that does not exist. There is no 403 here on purpose: a 403 would
 * confirm the id is real.
 */
export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ imageError?: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  const state = await readSessionState();
  if (state.kind !== 'authenticated') notFound();

  // An unparseable id cannot name a resource; treat it as absent rather than
  // letting Postgres raise.
  if (!isUuid(id)) notFound();

  const listing = await loadOwnedListingDetail(id, state.session.principal.userId);
  if (listing === null) notFound();

  const { imageError } = await searchParams;
  const t = await getTranslations('dashboard.listingForm');
  const tStatus = await getTranslations('dashboard.status');
  const tImages = await getTranslations('dashboard.images');

  const category = await loadCategoryBySlug(listing.category.slug);
  const definitions = category === null ? [] : await loadAttributeDefinitions(category);

  const translations = await prisma.attributeDefinitionTranslation.findMany({
    where: {
      attributeDefinitionId: { in: definitions.map((d) => d.id) },
      locale: { in: [locale, 'en'] },
    },
    select: { attributeDefinitionId: true, locale: true, label: true },
  });
  const optionLabels = await prisma.attributeOptionTranslation.findMany({
    where: {
      attributeOptionId: { in: definitions.flatMap((d) => d.options.map((o) => o.id)) },
      locale: { in: [locale, 'en'] },
    },
    select: { attributeOptionId: true, locale: true, label: true },
  });
  const pick = <T extends { locale: string }>(rows: T[]): T | undefined =>
    rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en');

  const stored = (listing.attributes ?? {}) as Record<string, unknown>;
  const attributes: AttributeInput[] = definitions.map((definition) => ({
    key: definition.key,
    dataType: definition.dataType,
    unit: definition.unit ?? null,
    isRequired: definition.isRequired,
    label:
      pick(translations.filter((tr) => tr.attributeDefinitionId === definition.id))?.label ??
      definition.key,
    options: definition.options.map((option) => ({
      value: option.value,
      label:
        pick(optionLabels.filter((o) => o.attributeOptionId === option.id))?.label ?? option.value,
    })),
    value: stored[definition.key] === undefined ? '' : String(stored[definition.key]),
  }));

  const editable = EDITABLE_STATUSES.includes(listing.status as never);
  const csrfToken = state.session.csrfToken;

  /** Which actions the state machine allows the OWNER right now. */
  const actions: { to: string; label: string; variant?: 'primary' | 'secondary' | 'danger' }[] = [];
  if (listing.status === 'DRAFT' || listing.status === 'REJECTED' || listing.status === 'EXPIRED') {
    actions.push({ to: 'PUBLISH', label: t('publish'), variant: 'primary' });
  }
  if (listing.status === 'ACTIVE') {
    actions.push({ to: 'PAUSED', label: t('pause') });
    actions.push({ to: 'SOLD', label: t('markSold') });
  }
  if (listing.status === 'PAUSED') {
    actions.push({ to: 'ACTIVE', label: t('resume'), variant: 'primary' });
    actions.push({ to: 'DRAFT', label: t('unpublish') });
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
            {listing.title}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={listing.status === 'ACTIVE' ? 'accent' : 'neutral'}>
              {tStatus(listing.status)}
            </Badge>
            {listing.status === 'ACTIVE' ? (
              <a
                href={listingPath(locale, listing.id, listing.slug)}
                className="text-accent-strong text-sm underline underline-offset-4"
              >
                {t('viewPublic')}
              </a>
            ) : null}
          </p>
        </div>
        <Link href="/dashboard/listings" className="text-ink-muted text-sm underline">
          {t('backToListings')}
        </Link>
      </div>

      {listing.rejectionReason ? (
        <div className="mt-6">
          <FormError>{listing.rejectionReason}</FormError>
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className="border-border mt-6 flex flex-wrap gap-3 rounded-[--radius-card] border p-4">
          {actions.map((action) => (
            <TransitionForm
              key={action.to}
              locale={locale}
              csrfToken={csrfToken}
              listingId={listing.id}
              to={action.to}
              label={action.label}
              variant={action.variant}
            />
          ))}
        </div>
      ) : null}

      <section aria-labelledby="images-heading" className="mt-10">
        <h2 id="images-heading" className="text-lg font-semibold">
          {tImages('heading')}
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          {tImages('limit', { max: listing.category.maxImages })}
        </p>

        {imageError ? (
          <div className="mt-3">
            <FormError>{tImages(`errors.${imageError}`)}</FormError>
          </div>
        ) : null}

        <ul className="mt-4 flex flex-wrap gap-4">
          {listing.images.map((image) => {
            const variants = (image.variants ?? {}) as Record<string, string>;
            return (
              <li key={image.id} className="w-32">
                <div className="bg-surface-sunken aspect-square overflow-hidden rounded-md">
                  {image.uploadStatus === 'READY' ? (
                    <ListingImage
                      url={variants.thumb ?? image.url}
                      alt={image.altText ?? ''}
                      sizes="128px"
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImagePlaceholder
                      label={tImages(`status.${image.uploadStatus}`)}
                      className="size-full"
                    />
                  )}
                </div>
                <p className="text-ink-muted mt-1 text-xs">
                  {image.isPrimary ? tImages('primary') : tImages(`status.${image.uploadStatus}`)}
                </p>
                {image.failureReason ? (
                  <p className="text-danger text-xs">{image.failureReason}</p>
                ) : null}
                <DeleteImageForm
                  locale={locale}
                  csrfToken={csrfToken}
                  listingId={listing.id}
                  imageId={image.id}
                  label={tImages('removeLabel')}
                />
              </li>
            );
          })}
        </ul>

        {/*
          A plain multipart form posting to a route handler: it needs no
          JavaScript, and the bytes go through the Phase 4 pipeline unchanged
          (magic-byte detection, re-encode, EXIF strip).
        */}
        <form
          action={`/${locale}/dashboard/listings/${listing.id}/images`}
          method="post"
          encType="multipart/form-data"
          className="border-border mt-6 flex max-w-lg flex-col gap-3 rounded-[--radius-card] border p-4"
        >
          <input type="hidden" name="_csrf" value={csrfToken} />
          <label htmlFor="file" className="text-sm font-medium">
            {tImages('addLabel')}
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            required
            className="text-sm"
          />
          <label htmlFor="altText" className="text-sm font-medium">
            {tImages('altLabel')}
          </label>
          <input
            id="altText"
            name="altText"
            maxLength={200}
            dir="auto"
            className="border-border rounded-md border px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPrimary" className="accent-accent size-4" />
            {tImages('makePrimary')}
          </label>
          <button
            type="submit"
            className="bg-accent text-accent-ink hover:bg-accent-strong self-start rounded-md px-4 py-2 text-sm font-medium"
          >
            {tImages('upload')}
          </button>
        </form>
      </section>

      <section aria-labelledby="details-heading" className="mt-10 max-w-2xl">
        <h2 id="details-heading" className="text-lg font-semibold">
          {t('detailsHeading')}
        </h2>
        <div className="mt-4">
          <EditListingForm
            locale={locale}
            csrfToken={csrfToken}
            listingId={listing.id}
            attributes={attributes}
            editable={editable}
            defaults={{
              title: listing.title,
              description: listing.description,
              priceMinor: listing.priceMinor === null ? '' : listing.priceMinor.toString(),
              priceType: listing.priceType,
              condition: listing.condition,
            }}
          />
        </div>
      </section>
    </>
  );
}
