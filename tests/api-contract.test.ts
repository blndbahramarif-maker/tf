import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
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

describe('OpenAPI covers every implemented route', () => {
  const root = path.resolve(__dirname, '..');

  /** Every `app/api/v1/**\/route.ts`, as an OpenAPI path template. */
  function implementedOperations(): Map<string, Set<string>> {
    const operations = new Map<string, Set<string>>();
    const base = path.join(root, 'app/api/v1');

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (entry.name !== 'route.ts') continue;

        // `app/api/v1/listings/[id]/images` -> `/listings/{id}/images`
        const template = `/${path
          .relative(base, dir)
          .split(path.sep)
          .filter((segment) => segment !== '')
          .map((segment) =>
            segment.startsWith('[') ? `{${segment.replace(/^\[+|\]+$/g, '')}}` : segment,
          )
          .join('/')}`;

        const source = readFileSync(full, 'utf8');
        const methods = new Set(
          [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
            (match) => match[1]!.toLowerCase(),
          ),
        );
        if (methods.size > 0) operations.set(template, methods);
      }
    };

    walk(base);
    return operations;
  }

  /**
   * Documented paths and their methods.
   *
   * Read with a line matcher rather than a YAML parser: the shape we care
   * about is two fixed indentation levels under `paths:`, and adding a parser
   * dependency to assert it would be the more fragile choice.
   */
  function documentedOperations(): Map<string, Set<string>> {
    const document = readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf8');
    const lines = document.split('\n');

    const start = lines.findIndex((line) => line === 'paths:');
    expect(start).toBeGreaterThan(-1);

    const operations = new Map<string, Set<string>>();
    let current: string | null = null;

    for (const line of lines.slice(start + 1)) {
      // A new top-level key ends the paths section.
      if (/^[a-z]/i.test(line)) break;

      const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
      if (pathMatch) {
        current = pathMatch[1]!;
        operations.set(current, new Set());
        continue;
      }

      const methodMatch = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
      if (methodMatch && current !== null) operations.get(current)!.add(methodMatch[1]!);
    }

    return operations;
  }

  it('documents every route file, with every method it exports', () => {
    // CLAUDE.md: "An API endpoint: define the schema in src/shared, document it
    // in openapi/openapi.yaml, implement in app/api/v1/". Without this test
    // that instruction is a convention nobody enforces, and the contract rots
    // the first time someone is in a hurry.
    const implemented = implementedOperations();
    const documented = documentedOperations();

    const missing: string[] = [];
    for (const [template, methods] of implemented) {
      const documentedMethods = documented.get(template);
      if (documentedMethods === undefined) {
        missing.push(`${template} (not documented at all)`);
        continue;
      }
      for (const method of methods) {
        if (!documentedMethods.has(method)) missing.push(`${method.toUpperCase()} ${template}`);
      }
    }

    expect(missing.sort()).toEqual([]);
  });

  it('does not promise endpoints that are not implemented', () => {
    // A contract that describes routes returning 404 is worse than no contract,
    // because clients are generated from it.
    const implemented = implementedOperations();
    const documented = documentedOperations();

    const phantom: string[] = [];
    for (const [template, methods] of documented) {
      const implementedMethods = implemented.get(template);
      if (implementedMethods === undefined) {
        phantom.push(`${template} (documented, no route file)`);
        continue;
      }
      for (const method of methods) {
        if (!implementedMethods.has(method)) phantom.push(`${method.toUpperCase()} ${template}`);
      }
    }

    expect(phantom.sort()).toEqual([]);
  });
});
