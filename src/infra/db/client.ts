import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { serverEnv } from '@/infra/env';

/**
 * Prisma client.
 *
 * Prisma 7 removed implicit DATABASE_URL reading: the client is constructed
 * with a driver adapter (ADR-0003, prisma.config.ts). That is why the URL is
 * passed explicitly here rather than picked up from the environment by magic.
 *
 * A single instance is cached on `globalThis` in development so Next.js hot
 * reload does not open a new connection pool on every edit and exhaust
 * Postgres's connection limit.
 */
const globalForPrisma = globalThis as unknown as {
  kurdoraPrisma?: PrismaClient;
};

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl ?? serverEnv().DATABASE_URL;
  const adapter = new PrismaPg({ connectionString: url });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.kurdoraPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.kurdoraPrisma = prisma;
}

export type { PrismaClient };
