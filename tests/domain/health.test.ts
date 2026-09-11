import { describe, expect, it } from 'vitest';
import { aggregateHealth, healthHttpStatus, type DependencyProbe } from '@/domain/system/health';

const at = new Date('2026-09-11T10:00:00.000Z');

const probe = (over: Partial<DependencyProbe> = {}): DependencyProbe => ({
  name: 'database',
  ok: true,
  critical: true,
  ...over,
});

describe('aggregateHealth', () => {
  it('is healthy when there are no probes', () => {
    // Phase 1 state: the process is up and configured, nothing to probe yet.
    expect(aggregateHealth([], at).status).toBe('healthy');
  });

  it('is healthy when every probe passes', () => {
    const report = aggregateHealth([probe(), probe({ name: 'redis' })], at);
    expect(report.status).toBe('healthy');
  });

  it('is unhealthy when a critical dependency fails', () => {
    const report = aggregateHealth([probe({ ok: false })], at);
    expect(report.status).toBe('unhealthy');
  });

  it('is degraded when only an optional dependency fails', () => {
    const report = aggregateHealth([probe({ name: 'search', ok: false, critical: false })], at);
    expect(report.status).toBe('degraded');
  });

  it('prefers unhealthy over degraded when both kinds fail', () => {
    const report = aggregateHealth(
      [probe({ ok: false }), probe({ name: 'search', ok: false, critical: false })],
      at,
    );
    expect(report.status).toBe('unhealthy');
  });

  it('records the check time as an ISO string', () => {
    expect(aggregateHealth([], at).checkedAt).toBe('2026-09-11T10:00:00.000Z');
  });
});

describe('healthHttpStatus', () => {
  it('serves 503 only when unhealthy', () => {
    expect(healthHttpStatus(aggregateHealth([probe({ ok: false })], at))).toBe(503);
    // Degraded must stay 200: the load balancer should keep sending traffic to
    // a node that can still serve, even if search is down.
    expect(
      healthHttpStatus(aggregateHealth([probe({ name: 's', ok: false, critical: false })], at)),
    ).toBe(200);
    expect(healthHttpStatus(aggregateHealth([], at))).toBe(200);
  });
});
