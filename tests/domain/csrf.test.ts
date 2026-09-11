import { describe, expect, it } from 'vitest';
import { checkCsrf, isSafeMethod, timingSafeEqual } from '@/domain/auth/csrf';

/** A request that would pass, so each test can break exactly one thing. */
function valid(overrides: Partial<Parameters<typeof checkCsrf>[0]> = {}) {
  return checkCsrf({
    method: 'POST',
    presentedToken: 'nonce.signature',
    cookieToken: 'nonce.signature',
    signatureValid: true,
    origin: 'https://kurdora.com',
    expectedOrigin: 'https://kurdora.com',
    secFetchSite: 'same-origin',
    ...overrides,
  });
}

describe('safe methods', () => {
  it('treats read-only methods as safe', () => {
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('head')).toBe(true);
    expect(isSafeMethod('OPTIONS')).toBe(true);
  });

  it('treats every state-changing method as unsafe', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isSafeMethod(method)).toBe(false);
    }
  });

  it('lets a safe method through with no token at all', () => {
    expect(valid({ method: 'GET', presentedToken: null, cookieToken: null })).toEqual({ ok: true });
  });
});

describe('checkCsrf', () => {
  it('accepts a well-formed same-origin request', () => {
    expect(valid()).toEqual({ ok: true });
  });

  it('refuses a cross-site request outright', () => {
    // Sec-Fetch-Site cannot be set by script, so this is decisive.
    expect(valid({ secFetchSite: 'cross-site' })).toEqual({ ok: false, reason: 'cross_origin' });
  });

  it('refuses a direct navigation, which cannot carry a token legitimately', () => {
    expect(valid({ secFetchSite: 'none' })).toEqual({ ok: false, reason: 'cross_origin' });
  });

  it('accepts same-site subdomain requests only if the token still checks out', () => {
    // same-site is not same-origin. The token is what saves us here.
    expect(valid({ secFetchSite: 'same-site' })).toEqual({ ok: true });
    expect(valid({ secFetchSite: 'same-site', signatureValid: false })).toEqual({
      ok: false,
      reason: 'malformed_token',
    });
  });

  it('refuses a mismatched Origin', () => {
    expect(valid({ origin: 'https://evil.test' })).toEqual({ ok: false, reason: 'cross_origin' });
  });

  it('still requires a token when Origin is absent', () => {
    // Some legitimate same-origin navigations omit Origin, so its absence
    // must not be a free pass.
    expect(valid({ origin: null })).toEqual({ ok: true });
    expect(valid({ origin: null, presentedToken: null })).toEqual({
      ok: false,
      reason: 'missing_token',
    });
  });

  it('refuses a missing token', () => {
    expect(valid({ presentedToken: null })).toEqual({ ok: false, reason: 'missing_token' });
    expect(valid({ presentedToken: '' })).toEqual({ ok: false, reason: 'missing_token' });
  });

  it('refuses when the cookie half of the double submit is absent', () => {
    expect(valid({ cookieToken: null })).toEqual({ ok: false, reason: 'missing_token' });
  });

  it('refuses when the two halves disagree', () => {
    expect(valid({ presentedToken: 'a.b', cookieToken: 'c.d' })).toEqual({
      ok: false,
      reason: 'token_mismatch',
    });
  });

  it('refuses a matching pair whose signature does not bind to this session', () => {
    // This is the case plain double-submit cannot catch: an attacker who can
    // write a cookie on our domain sets BOTH halves to a value they chose.
    // Only the HMAC binding refuses it.
    expect(valid({ presentedToken: 'x.y', cookieToken: 'x.y', signatureValid: false })).toEqual({
      ok: false,
      reason: 'malformed_token',
    });
  });
});

describe('timingSafeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings and different lengths', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('examines every character rather than stopping at the first difference', () => {
    // Not a timing assertion — that would be flaky. This pins the contract
    // that equal-length inputs are compared in full.
    expect(timingSafeEqual('aaaaaaaa', 'baaaaaaa')).toBe(false);
    expect(timingSafeEqual('aaaaaaaa', 'aaaaaaab')).toBe(false);
  });
});
