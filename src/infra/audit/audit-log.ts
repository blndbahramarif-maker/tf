import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Append-only audit logging.
 *
 * `audit_logs` has a trigger that refuses UPDATE and DELETE (ADR-0010), so
 * anything written here is permanent. That is the point: evidence that can be
 * edited is not evidence.
 *
 * What must NEVER be written: passwords, password hashes, tokens, TOTP secrets
 * or codes, or full request bodies. Log the fact and the identifiers.
 */

export type AuditAction =
  | 'auth.register'
  | 'auth.email_verified'
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.login_locked_out'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.token_refreshed'
  | 'auth.token_reuse_detected'
  | 'auth.step_up_succeeded'
  | 'auth.step_up_failed'
  | 'auth.password_changed'
  | 'auth.totp_enrolled'
  | 'auth.totp_verification_failed'
  | 'authz.denied'
  | 'seller_profile.created'
  | 'seller_profile.updated'
  | 'session.revoked'
  | 'admin.users_listed';

export interface AuditEntry {
  readonly action: AuditAction;
  readonly actorType: 'user' | 'admin' | 'system' | 'anonymous';
  readonly actorId?: string | null;
  readonly actorRole?: string | null;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly correlationId?: string | null;
}

/** Keys that must never reach the audit log, even if a caller passes them. */
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'secret',
  'totpSecret',
  'twoFactorSecretEnc',
  'two_factor_secret_enc',
  'code',
  'recoveryCode',
  'clientSecret',
  'authorization',
  'cookie',
]);

/** Strips secret-looking fields before persisting. Defence in depth. */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = FORBIDDEN_KEYS.has(key) ? '[redacted]' : redact(child);
  }
  return out;
}

export async function writeAuditLog(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: entry.action,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (redact(entry.before) as never),
      after: entry.after === undefined ? undefined : (redact(entry.after) as never),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      correlationId: entry.correlationId ?? null,
    },
  });
}

/**
 * Writes an audit entry without allowing a logging failure to break the
 * request it describes.
 *
 * Used for read-path and denial logging. Anything security-critical that MUST
 * be recorded (a login, a password change) uses `writeAuditLog` inside the
 * same transaction as the change, so the record and the effect are atomic.
 */
export async function tryWriteAuditLog(prisma: PrismaClient, entry: AuditEntry): Promise<void> {
  try {
    await writeAuditLog(prisma, entry);
  } catch (error) {
    console.error('[audit] failed to write entry', { action: entry.action, error });
  }
}
