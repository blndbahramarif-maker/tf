import { getStorage, LocalStorageDriver } from '@/infra/storage';

export const dynamic = 'force-dynamic';

/**
 * GET /media/{key} — serves processed derivatives for the LOCAL driver.
 *
 * Development and test only; in production a CDN serves these straight from
 * object storage.
 *
 * Only re-encoded `.webp` derivatives are servable. The original upload is
 * deleted after processing and is never reachable here even if a key is
 * guessed, and the response carries `nosniff` plus a Content-Type we chose —
 * never one derived from the request.
 */
export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const storage = getStorage();
  if (!(storage instanceof LocalStorageDriver)) {
    return new Response('Not found', { status: 404 });
  }

  const { key } = await context.params;
  const joined = key.join('/');

  // Refuse traversal and anything that is not a generated derivative.
  if (joined.includes('..') || !joined.endsWith('.webp')) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const body = await storage.getObject(joined);
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': 'image/webp',
        'content-length': String(body.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        // Belt and braces: even if something else were served, it could not
        // execute in the page's origin.
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
