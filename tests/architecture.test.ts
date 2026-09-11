import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

/**
 * These tests verify that the architectural guards actually fire.
 *
 * A lint rule nobody has tested is a rule you find out was broken when the
 * violation is already in production. Each case below lints a snippet against
 * the real project configuration and asserts the expected rule triggers.
 */

const cwd = path.resolve(__dirname, '..');
const eslint = new ESLint({ cwd });

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(cwd, filePath) });
  return result?.messages ?? [];
}

function ruleIds(messages: Awaited<ReturnType<typeof lint>>) {
  return messages.map((m) => m.ruleId);
}

describe('layer boundaries (ADR-0002)', () => {
  it('rejects Next.js imports in src/domain', async () => {
    // The guarantee that makes a future API extraction and the mobile apps
    // cheap: domain logic never learns it is inside a web framework.
    const messages = await lint(
      'src/domain/example.ts',
      `import { NextResponse } from 'next/server';\nexport const x = NextResponse;\n`,
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('rejects React imports in src/domain', async () => {
    const messages = await lint(
      'src/domain/example.ts',
      `import { useState } from 'react';\nexport const x = useState;\n`,
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('rejects Prisma imports in src/domain', async () => {
    // Domain depends on repository ports, not on the database client.
    const messages = await lint(
      'src/domain/example.ts',
      `import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;\n`,
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('rejects the Stripe SDK outside src/infra/stripe', async () => {
    // Exactly one module in the codebase may import the Stripe SDK.
    const messages = await lint(
      'src/domain/payments/charge.ts',
      `import Stripe from 'stripe';\nexport const x = Stripe;\n`,
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('rejects infrastructure imports in src/domain', async () => {
    const messages = await lint(
      'src/domain/example.ts',
      `import { serverEnv } from '@/infra/env';\nexport const x = serverEnv;\n`,
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('allows src/domain to import src/shared', async () => {
    const messages = await lint(
      'src/domain/example.ts',
      `import { ERROR_CODES } from '@/shared/api-contract';\nexport const x = ERROR_CODES;\n`,
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-imports');
  });

  it('rejects outward imports from src/shared', async () => {
    const messages = await lint(
      'src/shared/example.ts',
      `import { aggregateHealth } from '@/domain/system/health';\nexport const x = aggregateHealth;\n`,
    );
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('allows src/infra to import the Stripe SDK and Prisma', async () => {
    const messages = await lint(
      'src/infra/stripe/gateway.ts',
      `import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;\n`,
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-imports');
  });
});

describe('RTL guard (docs/09-i18n-rtl.md)', () => {
  // Each case must be a single JSX EXPRESSION: it is wrapped in `() => (...)`.
  const PREAMBLE = [
    'declare const cn: (...a: unknown[]) => string;',
    'declare const size: number;',
  ].join('\n');

  const cases: Array<[string, string]> = [
    ['margin-left', '<div className="ml-4" />'],
    ['padding-right', '<div className="pr-2" />'],
    ['text-left', '<div className="text-left" />'],
    ['positional left', '<div className="absolute left-0" />'],
    ['border-left', '<div className="border-l" />'],
    ['responsive variant', '<div className="md:ml-6" />'],
    ['interpolated template literal', '<div className={`ml-${size}`} />'],
    ['inside cn()', "<div className={cn('flex', 'pl-4')} />"],
    ['arbitrary value', '<div className="pl-[3px]" />'],
  ];

  it.each(cases)('flags %s', async (_name, jsx) => {
    const messages = await lint(
      'app/[locale]/example.tsx',
      `${PREAMBLE}\nexport const C = () => (${jsx});\n`,
    );
    // A parse error would surface as ruleId null and silently pass a
    // "not.toContain" assertion, so assert the snippet parsed cleanly too.
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    expect(ruleIds(messages)).toContain('kurdora/no-physical-direction-classes');
  });

  it('allows logical equivalents', async () => {
    const messages = await lint(
      'app/[locale]/example.tsx',
      `export const C = () => (<div className="ms-4 pe-2 text-start border-s absolute start-0" />);\n`,
    );
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    expect(ruleIds(messages)).not.toContain('kurdora/no-physical-direction-classes');
  });

  it('does not false-positive on unrelated utilities', async () => {
    // "flex", "block", "relative" and colour utilities must not trip the rule.
    const messages = await lint(
      'app/[locale]/example.tsx',
      `export const C = () => (<div className="flex relative block text-sm bg-surface rounded-lg" />);\n`,
    );
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    expect(ruleIds(messages)).not.toContain('kurdora/no-physical-direction-classes');
  });
});

describe('secret leakage guard (docs/08-security-architecture.md)', () => {
  it('flags a secret-looking NEXT_PUBLIC_ variable', async () => {
    // NEXT_PUBLIC_* is inlined into the browser bundle. A secret there is
    // public forever, including in git history and CDN caches.
    const messages = await lint(
      'src/lib/example.ts',
      `export const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;\n`,
    );
    expect(ruleIds(messages)).toContain('kurdora/no-public-env-secrets');
  });

  it('flags a NEXT_PUBLIC_ token', async () => {
    const messages = await lint(
      'src/lib/example.ts',
      `export const k = process.env.NEXT_PUBLIC_ADMIN_TOKEN;\n`,
    );
    expect(ruleIds(messages)).toContain('kurdora/no-public-env-secrets');
  });

  it('allows the Stripe publishable key, which is public by design', async () => {
    const messages = await lint(
      'src/lib/example.ts',
      `export const k = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;\n`,
    );
    expect(ruleIds(messages)).not.toContain('kurdora/no-public-env-secrets');
  });

  it('allows server-side secrets', async () => {
    const messages = await lint(
      'src/infra/example.ts',
      `export const k = process.env.STRIPE_SECRET_KEY;\n`,
    );
    expect(ruleIds(messages)).not.toContain('kurdora/no-public-env-secrets');
  });
});
