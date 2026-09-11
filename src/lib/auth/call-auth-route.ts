import { headers } from 'next/headers';
import { serverEnv } from '@/infra/env';

/**
 * Invokes an API route handler in-process from a Server Action.
 *
 * The browser auth flow deliberately does NOT reimplement login, registration
 * or verification. Those handlers carry per-account lockout, timing
 * equalisation so the endpoint cannot be used to enumerate accounts, TOTP
 * verification, rate limiting and audit logging. A second copy for the browser
 * would drift, and the copy that drifts is the one that quietly loses a
 * protection.
 *
 * So the action builds a Request, calls the same exported handler the API
 * route exports, and reads the result. There is no network hop and no second
 * implementation.
 *
 * The response body never reaches the browser: the action reads the tokens
 * here, on the server, writes them into HttpOnly cookies, and returns only a
 * status to the page. That is what keeps authentication material out of
 * JavaScript's reach.
 */

export interface RouteCallResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Headers worth forwarding: the handlers rate-limit and audit on these. */
const FORWARDED = ['x-forwarded-for', 'x-real-ip', 'user-agent', 'accept-language'];

export async function callAuthRoute(
  handler: (request: Request) => Promise<Response>,
  path: string,
  payload: unknown,
): Promise<RouteCallResult> {
  const incoming = await headers();
  const outgoing = new Headers({ 'content-type': 'application/json' });
  for (const name of FORWARDED) {
    const value = incoming.get(name);
    if (value !== null) outgoing.set(name, value);
  }

  const request = new Request(new URL(path, serverEnv().APP_URL), {
    method: 'POST',
    headers: outgoing,
    body: JSON.stringify(payload),
  });

  const response = await handler(request);
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // A handler that returned no body at all is not an error here; the status
    // is what the caller acts on.
    body = {};
  }
  return { status: response.status, body };
}

/** Pulls the first field-level message out of the standard error envelope. */
export function firstFieldError(body: Record<string, unknown>): string | null {
  const error = body.error as { fields?: { path: string; message: string }[] } | undefined;
  const field = error?.fields?.[0];
  return field ? `${field.path}: ${field.message}` : null;
}

export function errorMessage(body: Record<string, unknown>): string | null {
  const error = body.error as { message?: string } | undefined;
  return error?.message ?? null;
}

export function errorCode(body: Record<string, unknown>): string | null {
  const error = body.error as { code?: string } | undefined;
  return error?.code ?? null;
}
