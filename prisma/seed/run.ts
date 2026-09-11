#!/usr/bin/env tsx
import { config } from 'dotenv';
import { seed } from './index';

config({ path: ['.env.local', '.env'], quiet: true });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  console.log('\nSeeding platform configuration…\n');
  const result = await seed({ databaseUrl, log: console.log });
  console.log('\n✓ Seed complete (idempotent — safe to re-run)\n');
  console.log(
    `  ${result.categories} categories · ${result.attributes} attributes · ${result.roles} roles\n`,
  );
}

main().catch((error: unknown) => {
  console.error('\n✗ Seed failed:\n', error);
  process.exit(1);
});
