import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * GET /api/v1/openapi
 *
 * Serves the API contract so clients (the web app now, mobile later) can
 * generate typed clients from a single source of truth. The YAML file in
 * openapi/ is authoritative and is linted in CI.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const file = path.join(process.cwd(), 'openapi', 'openapi.yaml');
  const spec = await readFile(file, 'utf8');

  return new Response(spec, {
    headers: {
      'content-type': 'application/yaml; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
