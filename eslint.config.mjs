import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import kurdora from './tools/eslint/plugin.mjs';

/**
 * Layer boundaries (docs/02-system-architecture.md, ADR-0002).
 *
 *   src/shared  — pure: types, zod schemas, money maths, state machines.
 *   src/domain  — business logic. Framework-free. This is the rule that keeps
 *                 a future API extraction and the mobile apps cheap.
 *   src/infra   — adapters: prisma, stripe, redis, storage, mail.
 *   src/lib     — web-only glue (i18n runtime, react helpers).
 *   app/        — routes and UI.
 *
 * Dependencies point inwards only: app → lib → infra → domain → shared.
 */
const FRAMEWORK_IMPORTS = [
  { group: ['next', 'next/*'], message: 'Framework-free layer: must not import Next.js.' },
  {
    group: ['react', 'react-dom', 'react/*'],
    message: 'Framework-free layer: must not import React.',
  },
  {
    group: ['next-intl', 'next-intl/*'],
    message: 'Framework-free layer: must not import next-intl.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'coverage/**',
      'next-env.d.ts',
      'src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { kurdora },
    rules: {
      'kurdora/no-public-env-secrets': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Money is BIGINT minor units end to end (docs/03-database-architecture.md).
      // parseFloat on an amount is how rounding bugs get in.
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Money is integer minor units. Use the money helpers in src/shared/money.',
        },
      ],
    },
  },

  // ---- React / Next.js surface ----
  {
    files: ['app/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, kurdora },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'kurdora/no-physical-direction-classes': 'error',
    },
  },

  // ---- src/shared: pure, no framework, no layers above it ----
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK_IMPORTS,
            {
              group: ['@/domain/*', '@/infra/*', '@/lib/*'],
              message: 'src/shared is the innermost layer and must not import outward.',
            },
            {
              group: ['@prisma/client'],
              message: 'src/shared must not depend on the database client.',
            },
          ],
        },
      ],
    },
  },

  // ---- src/domain: business logic, framework-free ----
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK_IMPORTS,
            {
              group: ['@/infra/*', '@/lib/*'],
              message:
                'Domain must not depend on adapters. Depend on a port interface in src/domain/ports and let src/infra implement it.',
            },
            {
              group: ['@prisma/client'],
              message: 'Domain must not import Prisma. Define a repository port instead.',
            },
            {
              regex: '^stripe(/|$)',
              message:
                'Only src/infra/stripe may import the Stripe SDK (docs/02-system-architecture.md).',
            },
          ],
        },
      ],
    },
  },

  // ---- src/infra: adapters. May use SDKs, must not reach into the UI ----
  {
    files: ['src/infra/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/lib/*'], message: 'Infrastructure must not depend on web-only glue.' },
            {
              // Anchored: a bare `group` of 'stripe/*' is gitignore-style and
              // would also match '@/infra/stripe/gateway', which infra
              // modules legitimately import.
              regex: '^stripe(/|$)',
              message:
                'Only src/infra/stripe may import the Stripe SDK (CLAUDE.md non-negotiable 2).',
            },
          ],
        },
      ],
    },
  },

  // ---- src/infra/stripe: the ONE place the Stripe SDK may be imported ----
  //
  // Listed after the rule above so it overrides it. Keeping the SDK behind one
  // directory is what makes "swap the provider" a contained change rather than
  // an archaeology exercise, and it is also what keeps a Stripe type from
  // leaking into a route signature.
  {
    files: ['src/infra/stripe/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/lib/*'], message: 'Infrastructure must not depend on web-only glue.' },
          ],
        },
      ],
    },
  },

  // ---- app and src/lib: the web surface. Never the payment provider. ----
  {
    files: ['app/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^stripe(/|$)',
              message:
                'Routes and glue must go through the payment gateway port, never the Stripe SDK (CLAUDE.md non-negotiable 2).',
            },
            {
              // Routes must not know WHICH provider is configured either. They
              // ask `@/infra/payments` for a gateway and get a port back.
              group: ['@/infra/stripe', '@/infra/stripe/*'],
              message:
                'Get a gateway from @/infra/payments/gateway-provider, not from the Stripe adapter directly.',
            },
          ],
        },
      ],
    },
  },

  // ---- Tests and tooling ----
  {
    files: ['tests/**/*.ts', '**/*.test.ts', 'scripts/**/*.ts', 'worker/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
