#!/usr/bin/env tsx
/**
 * Validates the local environment before starting work.
 *
 *   pnpm env:check
 *
 * Exits non-zero with a readable summary so a misconfigured machine fails
 * here rather than three layers deep in a stack trace.
 */
import { config } from 'dotenv';
import { schemas } from '../src/infra/env';

config({ path: ['.env.local', '.env'], quiet: true });

const result = schemas.server.safeParse(process.env);

if (!result.success) {
  console.error('\n✗ Environment configuration is invalid:\n');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error('\n  Copy .env.example to .env.local and fill in the blanks.\n');
  process.exit(1);
}

const env = result.data;
console.log('\n✓ Environment is valid\n');
console.log(`  APP_ENV      ${env.APP_ENV}`);
console.log(`  APP_URL      ${env.APP_URL}`);
console.log(`  DATABASE_URL ${env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@')}`);
console.log(`  REDIS_URL    ${env.REDIS_URL}`);
console.log(
  `  Stripe       ${env.STRIPE_SECRET_KEY ? 'configured' : 'not configured (service billing is optional)'}`,
);
console.log('');
