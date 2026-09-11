#!/usr/bin/env tsx
/**
 * Guards migrations against two recurring hazards.
 *
 *   pnpm check:migrations
 *
 * 1. `prisma migrate dev` cannot see database objects that are absent from
 *    schema.prisma — raw-SQL indexes, triggers, CHECK constraints — so it
 *    generates DROP statements for them as if they were drift. This has
 *    happened in BOTH Phase 3 and Phase 4. The migration tests would catch it
 *    eventually; this catches it at the moment the migration is written.
 *
 * 2. Every migration must ship a `down.sql`. Prisma has no native down
 *    migrations, so reversibility is ours to own (ADR-0003).
 */
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

/**
 * Objects created by raw SQL that Prisma does not know about. Dropping any of
 * these silently removes an index or an invariant the application depends on.
 */
const PROTECTED_OBJECTS = [
  // Phase 2 — search and faceting indexes
  'listings_attributes_gin',
  'listings_title_trgm',
  'seller_profiles_display_name_trgm',
  // Phase 2 — ledger and audit invariants
  'ledger_entries_must_balance',
  'ledger_entries_append_only',
  'audit_logs_append_only',
  'kurdora_assert_ledger_balanced',
  'kurdora_reject_mutation',
  // Phase 4 — search
  'listings_search_document',
  'listings_search_document_gin',
];

interface Problem {
  migration: string;
  message: string;
}

async function main(): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const problems: Problem[] = [];

  for (const migration of migrations) {
    const dir = path.join(MIGRATIONS_DIR, migration);

    try {
      await access(path.join(dir, 'down.sql'));
    } catch {
      problems.push({ migration, message: 'missing down.sql' });
    }

    const sql = await readFile(path.join(dir, 'migration.sql'), 'utf8');
    // Strip comments so an explanatory note mentioning a drop is not flagged.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    for (const object of PROTECTED_OBJECTS) {
      const dropPattern = new RegExp(`DROP\\s+(INDEX|TRIGGER|FUNCTION)[^;]*\\b${object}\\b`, 'i');
      if (!dropPattern.test(statements)) continue;

      // A drop is legitimate when the same migration recreates the object.
      const recreatePattern = new RegExp(
        `CREATE\\s+(OR\\s+REPLACE\\s+)?(UNIQUE\\s+)?(INDEX|TRIGGER|CONSTRAINT\\s+TRIGGER|FUNCTION)[^;]*\\b${object}\\b`,
        'i',
      );
      if (recreatePattern.test(statements)) continue;

      problems.push({
        migration,
        message:
          `drops "${object}" without recreating it.\n` +
          `      This object is created by raw SQL that Prisma cannot see, so ` +
          `\`prisma migrate dev\`\n      generates a spurious DROP. Remove the ` +
          `DROP statement from the migration.`,
      });
    }
  }

  if (problems.length > 0) {
    console.error('\n✗ Migration check failed:\n');
    for (const problem of problems) {
      console.error(`  ${problem.migration}: ${problem.message}`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(`✓ ${migrations.length} migrations checked: all reversible, no spurious drops`);
}

main().catch((error: unknown) => {
  console.error('Migration check errored:', error);
  process.exit(1);
});
