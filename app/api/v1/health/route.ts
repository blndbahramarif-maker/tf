import { aggregateHealth, healthHttpStatus, type DependencyProbe } from '@/domain/system/health';
import { serverEnv } from '@/infra/env';
import { ok } from '@/lib/api/respond';
import type { HealthResponse } from '@/shared/api-contract';

/**
 * GET /api/v1/health
 *
 * Liveness and readiness. Used by CI, by docker-compose healthchecks and by
 * the load balancer.
 *
 * Phase 1 scope: reports process health and configuration only. Database,
 * Redis and storage probes are added in Phase 2 when there is a schema to
 * probe — `aggregateHealth` already handles them, so that change is additive.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const env = serverEnv();

  // No dependency probes yet. An empty probe list is legitimately "healthy":
  // the process is up and correctly configured.
  const probes: DependencyProbe[] = [];

  const report = aggregateHealth(probes, new Date());

  const body: HealthResponse = {
    status: report.status,
    checkedAt: report.checkedAt,
    version: process.env.APP_VERSION ?? '0.1.0',
    appEnv: env.APP_ENV,
    dependencies: report.dependencies.map((probe) => ({
      name: probe.name,
      ok: probe.ok,
      critical: probe.critical,
      ...(probe.latencyMs === undefined ? {} : { latencyMs: probe.latencyMs }),
      ...(probe.detail === undefined ? {} : { detail: probe.detail }),
    })),
  };

  void request;

  return ok(body, {
    status: healthHttpStatus(report),
    headers: { 'cache-control': 'no-store' },
  });
}
