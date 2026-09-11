import Redis from 'ioredis';

/**
 * Redis connection.
 *
 * Cached on globalThis so Next.js hot reload does not open a new connection on
 * every edit.
 */
const globalForRedis = globalThis as unknown as { kurdoraRedis?: Redis };

export function createRedisClient(url?: string): Redis {
  const connectionString = url ?? process.env.REDIS_URL;
  if (!connectionString) throw new Error('REDIS_URL is not set');

  return new Redis(connectionString, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

export function getRedis(): Redis {
  globalForRedis.kurdoraRedis ??= createRedisClient();
  return globalForRedis.kurdoraRedis;
}

export type { Redis };
