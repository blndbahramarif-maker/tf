/**
 * Health aggregation.
 *
 * Deliberately pure: it takes probe results and returns a verdict. It knows
 * nothing about HTTP, Next.js, Prisma or Redis. That is the whole point — this
 * module is the first proof that src/domain is framework-free and unit-testable
 * without booting anything (ADR-0002).
 *
 * Dependency probes themselves are adapters and arrive in Phase 2, once there
 * is a database schema to probe.
 */

export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyProbe {
  /** Stable identifier, e.g. "database", "redis", "storage". */
  readonly name: string;
  /** Whether the dependency answered successfully. */
  readonly ok: boolean;
  /** Round-trip time in milliseconds, when measured. */
  readonly latencyMs?: number;
  /**
   * If false, the app can still serve traffic without this dependency.
   * A failing optional dependency degrades; a failing critical one is fatal.
   */
  readonly critical: boolean;
  /** Non-sensitive failure summary. Must never contain credentials. */
  readonly detail?: string;
}

export interface HealthReport {
  readonly status: HealthState;
  readonly checkedAt: string;
  readonly dependencies: readonly DependencyProbe[];
}

/**
 * Rules:
 *   any failing critical dependency  → unhealthy
 *   any failing optional dependency  → degraded
 *   otherwise                        → healthy
 */
export function aggregateHealth(probes: readonly DependencyProbe[], checkedAt: Date): HealthReport {
  const hasCriticalFailure = probes.some((probe) => probe.critical && !probe.ok);
  const hasOptionalFailure = probes.some((probe) => !probe.critical && !probe.ok);

  let status: HealthState = 'healthy';
  if (hasCriticalFailure) {
    status = 'unhealthy';
  } else if (hasOptionalFailure) {
    status = 'degraded';
  }

  return {
    status,
    checkedAt: checkedAt.toISOString(),
    dependencies: probes,
  };
}

/** HTTP status a health report should be served with. */
export function healthHttpStatus(report: HealthReport): 200 | 503 {
  return report.status === 'unhealthy' ? 503 : 200;
}
