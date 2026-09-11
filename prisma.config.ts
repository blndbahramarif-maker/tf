import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// .env.local takes precedence, matching Next.js and scripts/check-env.ts.
config({ path: ['.env.local', '.env'], quiet: true });

/**
 * Prisma 7 configuration.
 *
 * Prisma 7 removed `url` from the `datasource` block in schema.prisma: the
 * connection URL now lives here (for CLI commands such as migrate and
 * introspect), and the runtime client takes a driver adapter instead.
 *
 * Consequence for Phase 2: PrismaClient must be constructed with an adapter
 * (`@prisma/adapter-pg`) rather than reading DATABASE_URL implicitly. That
 * adapter is added in Phase 2 alongside the first models — adding it now would
 * be a dependency with nothing to connect to.
 *
 * See docs/adr/0003-postgresql-and-prisma.md.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',

  datasource: {
    url: env('DATABASE_URL'),
    // Migrate needs a scratch database to diff against. Left unset locally so
    // Prisma creates and drops a temporary one; set explicitly in CI/staging
    // where the database user may not have CREATE DATABASE.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },

  migrations: {
    path: 'prisma/migrations',
  },
});
