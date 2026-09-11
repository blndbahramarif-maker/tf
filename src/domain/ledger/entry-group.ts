/**
 * Double-entry ledger primitives.
 *
 * Every money movement is recorded as a balanced GROUP of entries. Within a
 * group, debits must equal credits, per currency.
 *
 * The database enforces this with a deferred constraint trigger, so an
 * unbalanced group can never be committed by anyone. This module enforces the
 * same rule in application code — not because the database check is
 * insufficient, but so that a mistake surfaces at the point it was made, with
 * the offending entries in hand, rather than as a constraint violation at
 * COMMIT with no context.
 *
 * See docs/03-database-architecture.md and the migration
 * `constraints_triggers_indexes`.
 */

export type LedgerAccount =
  | 'STRIPE_BALANCE'
  | 'SELLER_PAYABLE'
  | 'PLATFORM_REVENUE'
  | 'PAYMENT_FEES'
  | 'REFUNDS'
  | 'DISPUTES'
  | 'TAX_COLLECTED'
  | 'PROMOTIONS'
  | 'SUBSCRIPTIONS';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface LedgerEntryDraft {
  readonly account: LedgerAccount;
  readonly direction: LedgerDirection;
  /** Always positive. The direction carries the sign. */
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly description: string;
  readonly orderId?: string;
  readonly payoutId?: string;
  readonly refundId?: string;
  readonly sellerProfileId?: string;
}

export interface EntryGroupDraft {
  readonly entryGroupId: string;
  readonly entries: readonly LedgerEntryDraft[];
  readonly occurredAt: Date;
  readonly livemode: boolean;
}

export class LedgerImbalanceError extends Error {
  constructor(
    readonly currency: string,
    readonly netMinor: bigint,
    readonly entries: readonly LedgerEntryDraft[],
  ) {
    super(
      `Ledger group does not balance in ${currency}: net ${netMinor} minor units. ` +
        `Debits must equal credits. Entries: ` +
        entries.map((e) => `${e.direction} ${e.amountMinor} ${e.currency} ${e.account}`).join('; '),
    );
    this.name = 'LedgerImbalanceError';
  }
}

/** DEBIT is positive, CREDIT is negative. */
export function signedAmount(entry: LedgerEntryDraft): bigint {
  return entry.direction === 'DEBIT' ? entry.amountMinor : -entry.amountMinor;
}

/** Net movement per currency. A balanced group nets to zero in every currency. */
export function netByCurrency(entries: readonly LedgerEntryDraft[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + signedAmount(entry));
  }
  return totals;
}

export function isBalanced(entries: readonly LedgerEntryDraft[]): boolean {
  for (const net of netByCurrency(entries).values()) {
    if (net !== 0n) return false;
  }
  return true;
}

/**
 * Throws unless the group balances in every currency.
 *
 * Note that currencies are checked SEPARATELY: a group holding +100 GBP and
 * −100 EUR does not balance. Netting across currencies would silently invent
 * an exchange rate.
 */
export function assertBalanced(entries: readonly LedgerEntryDraft[]): void {
  if (entries.length === 0) {
    throw new LedgerImbalanceError('n/a', 0n, entries);
  }
  for (const [currency, net] of netByCurrency(entries)) {
    if (net !== 0n) throw new LedgerImbalanceError(currency, net, entries);
  }
}

/** Validates and returns a group, ready to persist. */
export function buildEntryGroup(draft: EntryGroupDraft): EntryGroupDraft {
  for (const entry of draft.entries) {
    if (entry.amountMinor <= 0n) {
      throw new RangeError(
        `Ledger amounts must be positive; direction carries the sign. ` +
          `Received ${entry.amountMinor} for ${entry.account}.`,
      );
    }
    if (entry.currency !== entry.currency.toUpperCase() || entry.currency.length !== 3) {
      throw new TypeError(
        `Currency must be a 3-letter uppercase code, received "${entry.currency}"`,
      );
    }
  }
  assertBalanced(draft.entries);
  return draft;
}
