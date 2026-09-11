import { MAX_UPLOAD_BYTES } from '@/infra/images/processor';
import { getStorage, LocalStorageDriver } from '@/infra/storage';
import { fail, ok } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/v1/uploads/{token} — receives bytes for the LOCAL storage driver.
 *
 * Development and test only. In production the S3 driver issues a presigned
 * URL and the browser PUTs straight to the bucket, so bytes never reach this
 * process — this route returns 404 there.
 *
 * The token is an HMAC-signed, expiring ticket naming the exact storage key
 * and byte ceiling. It is unforgeable and cannot be pointed at another key,
 * which is the same property a presigned URL provides. No session is required:
 * possession of the ticket IS the authorisation, and the ticket was issued to
 * an authenticated owner moments earlier.
 */
export async function PUT(request: Request, context: { params: Promise<{ token: string }> }) {
  const storage = getStorage();

  if (!(storage instanceof LocalStorageDriver)) {
    // Nothing should ever upload through the API in production.
    return fail('not_found', 'Not found.', { request, status: 404 });
  }

  const { token } = await context.params;
  const ticket = storage.verify(token);
  if (ticket === null) {
    return fail('unauthenticated', 'Upload link is invalid or has expired.', {
      request,
      status: 401,
    });
  }

  // Reject on the declared length before reading, so an oversized body is not
  // buffered into memory first.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > ticket.maxBytes) {
    return fail('validation_failed', 'File is too large.', { request });
  }

  const body = Buffer.from(await request.arrayBuffer());

  // Re-check the ACTUAL length: Content-Length is a claim.
  if (body.length === 0) {
    return fail('validation_failed', 'Empty upload.', { request });
  }
  if (body.length > Math.min(ticket.maxBytes, MAX_UPLOAD_BYTES)) {
    return fail('validation_failed', 'File is too large.', { request });
  }

  // Stored as-is. NOTHING validates the content here — that is deliberate:
  // validation and re-encoding happen in the finalise step, so this route
  // never has to decide whether attacker bytes are safe.
  await storage.putObject(ticket.storageKey, body, 'application/octet-stream');

  return ok({ status: 'uploaded', bytes: body.length });
}
