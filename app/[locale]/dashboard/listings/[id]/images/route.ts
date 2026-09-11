import { NextResponse } from 'next/server';
import { POST as startUpload } from '../../../../../api/v1/listings/[id]/images/route';
import { POST as finaliseImage } from '../../../../../api/v1/listings/[id]/images/[imageId]/route';
import { PUT as receiveUpload } from '../../../../../api/v1/uploads/[token]/route';
import { MAX_UPLOAD_BYTES } from '@/infra/images/processor';
import { ACCESS_COOKIE, CSRF_FIELD, readCookie } from '@/infra/auth/session-cookies';
import { isUuid, requireAccess } from '@/lib/api/guards';
import { serverEnv } from '@/infra/env';

export const dynamic = 'force-dynamic';

/**
 * POST /{locale}/dashboard/listings/{id}/images — browser image upload.
 *
 * A route handler rather than a Server Action because Server Actions are not
 * a good fit for a large binary body, and because a plain `<form
 * enctype="multipart/form-data">` posting here works with JavaScript disabled.
 *
 * It reimplements NONE of the image pipeline. It calls the three Phase 4
 * handlers in process — issue ticket, receive bytes, finalise — so magic-byte
 * detection, the dimension and pixel caps, WebP re-encoding, EXIF/GPS
 * stripping and deletion of the original all happen exactly as they do for an
 * API client. A second copy of that pipeline is the last thing this codebase
 * needs.
 *
 * Authorization is done HERE, once, on the browser's credentials: CSRF against
 * the form field, then ownership through `requireAccess` + the inner handler's
 * own `requireOwner`. The in-process calls then present the caller's own
 * access token as a bearer, which is the same principal — not an escalation.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; locale: string }> },
) {
  const { id, locale } = await context.params;
  if (!isUuid(id))
    return NextResponse.redirect(dashboardUrl(request, locale, null, 'not_found'), 303);

  const form = await request.formData();
  const csrfToken = form.get(CSRF_FIELD);

  // The browser is cookie-authenticated, so CSRF is mandatory. Passing the
  // form token in means `requireAccess` enforces it rather than this handler
  // deciding for itself.
  const access = await requireAccess(
    request,
    { all: ['listing:update_own'] },
    { csrfFormToken: typeof csrfToken === 'string' ? csrfToken : null },
  );
  if (!access.ok) {
    return NextResponse.redirect(dashboardUrl(request, locale, id, 'forbidden'), 303);
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(dashboardUrl(request, locale, id, 'no_file'), 303);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.redirect(dashboardUrl(request, locale, id, 'too_large'), 303);
  }

  // The caller's OWN token, forwarded to the in-process handlers.
  const bearer = readCookie(request, ACCESS_COOKIE);
  if (bearer === null) {
    return NextResponse.redirect(dashboardUrl(request, locale, id, 'forbidden'), 303);
  }
  const authHeaders = () =>
    new Headers({ 'content-type': 'application/json', authorization: `Bearer ${bearer}` });

  const base = serverEnv().APP_URL;

  // 1. Ticket + placeholder row. Enforces the per-category image cap.
  const started = await startUpload(
    new Request(new URL(`/api/v1/listings/${id}/images`, base), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        declaredContentType: file.type || 'application/octet-stream',
        altText: typeof form.get('altText') === 'string' ? String(form.get('altText')) : undefined,
      }),
    }),
    { params: Promise.resolve({ id }) },
  );

  if (started.status !== 201) {
    const reason = started.status === 409 ? 'image_limit' : 'forbidden';
    return NextResponse.redirect(dashboardUrl(request, locale, id, reason), 303);
  }

  const ticket = (await started.json()) as {
    imageId: string;
    upload: { url: string };
  };
  const token = ticket.upload.url.split('/uploads/')[1] ?? '';

  // 2. Bytes. Nothing here inspects or trusts them.
  const bytes = Buffer.from(await file.arrayBuffer());
  await receiveUpload(
    new Request(new URL(`/api/v1/uploads/${token}`, base), {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: new Headers({ 'content-length': String(bytes.length) }),
    }),
    { params: Promise.resolve({ token }) },
  );

  // 3. Validate, re-encode, strip EXIF, delete the original.
  const finalised = await finaliseImage(
    new Request(new URL(`/api/v1/listings/${id}/images/${ticket.imageId}`, base), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        isPrimary: form.get('isPrimary') === 'on',
        ...(typeof form.get('altText') === 'string' && form.get('altText') !== ''
          ? { altText: String(form.get('altText')) }
          : {}),
      }),
    }),
    { params: Promise.resolve({ id, imageId: ticket.imageId }) },
  );

  if (finalised.status !== 200) {
    // The row is left in FAILED by the finalise handler, so the seller can see
    // that the upload was refused rather than silently losing it.
    return NextResponse.redirect(dashboardUrl(request, locale, id, 'image_rejected'), 303);
  }

  return NextResponse.redirect(dashboardUrl(request, locale, id, null), 303);
}

function dashboardUrl(
  request: Request,
  locale: string,
  listingId: string | null,
  error: string | null,
): URL {
  const path =
    listingId === null
      ? `/${locale}/dashboard/listings`
      : `/${locale}/dashboard/listings/${listingId}`;
  const url = new URL(path, new URL(request.url).origin);
  if (error !== null) url.searchParams.set('imageError', error);
  return url;
}
