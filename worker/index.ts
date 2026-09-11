/**
 * Background worker entrypoint.
 *
 *   pnpm worker
 *
 * Runs as a SEPARATE PROCESS from the web app, even in the lean single-app
 * architecture (ADR-0001). This is a correctness requirement rather than a
 * scale optimisation: Stripe webhook processing, payout reconciliation and
 * scheduled expiry must not share a web request's lifecycle, where a timeout
 * or a redeploy could abandon a half-applied money operation.
 *
 * PHASE 1: no processors registered yet. Queues arrive with the work that
 * needs them — webhook processing in Phase 7, reconciliation in Phase 8.
 */

async function main(): Promise<void> {
  console.log('[worker] starting');
  console.log('[worker] no queues registered yet (Phase 1)');

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Keep the process alive so the container does not restart-loop.
  await new Promise(() => {});
}

main().catch((error: unknown) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
