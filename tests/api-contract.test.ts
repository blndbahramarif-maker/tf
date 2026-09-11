import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  apiErrorSchema,
  healthResponseSchema,
  moneySchema,
  pageSchema,
  paginationQuerySchema,
} from '@/shared/api-contract';
import { z } from 'zod';

describe('money on the wire', () => {
  it('accepts an integer string', () => {
    // £50,000.00 in minor units.
    const parsed = moneySchema.parse({ amountMinor: '5000000', currency: 'GBP' });
    expect(parsed.amountMinor).toBe('5000000');
  });

  it('survives values beyond JavaScript number precision', () => {
    // This is the whole reason amounts cross the wire as strings: parsing this
    // as a JSON number would silently change the value.
    const huge = '9007199254740993'; // 2^53 + 1
    expect(moneySchema.parse({ amountMinor: huge, currency: 'GBP' }).amountMinor).toBe(huge);
    expect(BigInt(huge).toString()).toBe(huge);
    expect(String(Number(huge))).not.toBe(huge);
  });

  it('rejects a decimal amount', () => {
    // "50.00" would mean someone is sending major units. Catch it at the edge.
    expect(moneySchema.safeParse({ amountMinor: '50.00', currency: 'GBP' }).success).toBe(false);
  });

  it('rejects a numeric amount', () => {
    expect(moneySchema.safeParse({ amountMinor: 5000, currency: 'GBP' }).success).toBe(false);
  });

  it('accepts negative amounts, for refunds and reversals', () => {
    expect(moneySchema.safeParse({ amountMinor: '-2500', currency: 'GBP' }).success).toBe(true);
  });

  it('normalises the currency code to upper case', () => {
    expect(moneySchema.parse({ amountMinor: '100', currency: 'gbp' }).currency).toBe('GBP');
  });

  it('rejects a currency code that is not three characters', () => {
    expect(moneySchema.safeParse({ amountMinor: '100', currency: 'POUND' }).success).toBe(false);
  });
});

describe('pagination', () => {
  it('defaults to a sensible page size', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(24);
  });

  it('coerces a query-string limit', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('caps the page size', () => {
    // Prevents a client from requesting the entire listing table in one call.
    expect(paginationQuerySchema.safeParse({ limit: '5000' }).success).toBe(false);
  });

  it('builds a page envelope around any item schema', () => {
    const schema = pageSchema(z.object({ id: z.string() }));
    const parsed = schema.parse({
      data: [{ id: 'a' }],
      page: { nextCursor: null, hasMore: false },
    });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.page.hasMore).toBe(false);
  });
});

describe('error envelope', () => {
  it('requires a machine-readable code and a request id', () => {
    const ok = apiErrorSchema.safeParse({
      error: { code: 'not_found', message: 'No such listing', requestId: 'req_1' },
    });
    expect(ok.success).toBe(true);

    // Clients switch on `code`, so it must never be free text.
    expect(
      apiErrorSchema.safeParse({
        error: { code: 'something_went_wrong', message: 'x', requestId: 'r' },
      }).success,
    ).toBe(false);
  });

  it('carries field errors for validation failures', () => {
    const parsed = apiErrorSchema.parse({
      error: {
        code: 'validation_failed',
        message: 'Invalid listing',
        fields: [{ path: 'listing.priceMinor', message: 'Required' }],
        requestId: 'req_2',
      },
    });
    expect(parsed.error.fields?.[0]?.path).toBe('listing.priceMinor');
  });

  it('includes an idempotency conflict code', () => {
    // Required by ADR-0004: replaying a key must be distinguishable from a
    // generic conflict so clients can handle it without retrying blindly.
    expect(ERROR_CODES).toContain('idempotency_key_reused');
  });
});

describe('health response', () => {
  it('matches what the endpoint returns in Phase 1', () => {
    const parsed = healthResponseSchema.parse({
      status: 'healthy',
      checkedAt: '2026-09-11T10:00:00.000Z',
      version: '0.1.0',
      appEnv: 'local',
      dependencies: [],
    });
    expect(parsed.status).toBe('healthy');
  });

  it('rejects an unknown status', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'probably fine',
        checkedAt: '2026-09-11T10:00:00.000Z',
        version: '0.1.0',
        appEnv: 'local',
        dependencies: [],
      }).success,
    ).toBe(false);
  });
});
