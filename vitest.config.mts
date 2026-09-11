import { defineConfig } from 'vitest/config';
import path from 'node:path';

const here = import.meta.dirname;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**', 'src/shared/**', 'packages/**/src/**'],
      // Floors, not targets. Actual Phase 1 coverage is ~98%; these are set
      // just below it so a regression fails CI rather than passing quietly.
      // Payments, commission and ledger code target >= 95% from Phase 8.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@/': `${path.resolve(here, 'src')}/`,
      '@kurdora/brand': path.resolve(here, 'packages/brand/src/index.ts'),
      '@kurdora/i18n': path.resolve(here, 'packages/i18n/src/index.ts'),
    },
  },
});
