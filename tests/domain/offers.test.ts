import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFER_TTL_DAYS,
  MAX_OFFER_TTL_DAYS,
  OFFER_STATUSES,
  OFFER_TRANSITIONS,
  TERMINAL_STATUSES,
  availableTransitions,
  canTransitionOffer,
  hasExpired,
  isTerminal,
  offerExpiryFrom,
  type OfferActor,
  type OfferStatus,
} from '@/domain/offers/offer-status';
import { MAX_OFFER_MINOR, validateOfferAmount } from '@/domain/offers/offer-amount';

/**
 * The offer lifecycle, with no database in sight.
 *
 * The table is the specification, so these tests read it as data rather than
 * restating it: the exhaustive sweep below asserts that EVERY (from, to, actor)
 * triple not in the table is refused, which is a much stronger claim than
 * listing the handful of refusals someone thought of.
 */
describe('the offer state machine', () => {
  const ACTORS: OfferActor[] = ['buyer', 'seller', 'system'];

  describe('the transition table', () => {
    it('names only statuses that exist', () => {
      for (const transition of OFFER_TRANSITIONS) {
        expect(OFFER_STATUSES).toContain(transition.from);
        expect(OFFER_STATUSES).toContain(transition.to);
        expect(transition.actors.length).toBeGreaterThan(0);
      }
    });

    it('never leaves a terminal status', () => {
      // A deal that is declined cannot un-decline itself. If this ever fails,
      // the history stops being a record of what happened.
      for (const transition of OFFER_TRANSITIONS) {
        expect(TERMINAL_STATUSES).not.toContain(transition.from);
      }
    });

    it('leaves COUNTERED and CONVERTED unreachable, as documented', () => {
      // Both are reserved for later phases. An unreachable state is honest
      // about what is not built; a transition invented for it would not be.
      const reachable = new Set(OFFER_TRANSITIONS.map((transition) => transition.to));
      expect(reachable.has('COUNTERED')).toBe(false);
      expect(reachable.has('CONVERTED')).toBe(false);
    });

    it('has no duplicate (from, to, actor) rows', () => {
      const seen = new Set<string>();
      for (const transition of OFFER_TRANSITIONS) {
        for (const actor of transition.actors) {
          const key = `${transition.from}->${transition.to}:${actor}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    });
  });

  describe('what each actor may do', () => {
    it('lets the seller answer a submitted offer and the buyer withdraw it', () => {
      expect(canTransitionOffer('SUBMITTED', 'ACCEPTED', 'seller').allowed).toBe(true);
      expect(canTransitionOffer('SUBMITTED', 'DECLINED', 'seller').allowed).toBe(true);
      expect(canTransitionOffer('SUBMITTED', 'WITHDRAWN', 'buyer').allowed).toBe(true);
    });

    it('refuses a seller withdrawing the buyer’s offer', () => {
      const decision = canTransitionOffer('SUBMITTED', 'WITHDRAWN', 'seller');
      expect(decision).toEqual({ allowed: false, reason: 'wrong_actor' });
    });

    it('refuses a buyer answering their own offer', () => {
      expect(canTransitionOffer('SUBMITTED', 'ACCEPTED', 'buyer')).toEqual({
        allowed: false,
        reason: 'wrong_actor',
      });
      expect(canTransitionOffer('SUBMITTED', 'DECLINED', 'buyer')).toEqual({
        allowed: false,
        reason: 'wrong_actor',
      });
    });

    it('refuses a buyer reversing the seller’s decision', () => {
      for (const settled of ['DECLINED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED'] as OfferStatus[]) {
        expect(canTransitionOffer(settled, 'ACCEPTED', 'buyer').allowed).toBe(false);
        expect(canTransitionOffer(settled, 'SUBMITTED', 'buyer').allowed).toBe(false);
      }
    });

    it('distinguishes "you may not" from "that is impossible"', () => {
      // The reasons differ so a caller can tell a wrong actor from a move that
      // does not exist at all. Collapsing them would lose that.
      expect(canTransitionOffer('SUBMITTED', 'WITHDRAWN', 'seller')).toMatchObject({
        reason: 'wrong_actor',
      });
      expect(canTransitionOffer('SUBMITTED', 'CONVERTED', 'seller')).toMatchObject({
        reason: 'unknown_transition',
      });
      expect(canTransitionOffer('SUBMITTED', 'SUBMITTED', 'seller')).toMatchObject({
        reason: 'no_op',
      });
    });

    it('refuses every triple the table does not contain', () => {
      // The exhaustive check: 9 statuses × 9 statuses × 3 actors = 243 moves,
      // of which only the table's rows may be allowed.
      const allowed = new Set(
        OFFER_TRANSITIONS.flatMap((transition) =>
          transition.actors.map((actor) => `${transition.from}->${transition.to}:${actor}`),
        ),
      );

      let checked = 0;
      for (const from of OFFER_STATUSES) {
        for (const to of OFFER_STATUSES) {
          for (const actor of ACTORS) {
            checked += 1;
            const expected = allowed.has(`${from}->${to}:${actor}`);
            expect(
              canTransitionOffer(from, to, actor).allowed,
              `${from} -> ${to} as ${actor}`,
            ).toBe(expected);
          }
        }
      }
      expect(checked).toBe(OFFER_STATUSES.length * OFFER_STATUSES.length * ACTORS.length);
    });

    it('offers a party exactly the moves the table gives their role', () => {
      expect(availableTransitions('SUBMITTED', 'seller').map((t) => t.to).sort()).toEqual([
        'ACCEPTED',
        'DECLINED',
      ]);
      expect(availableTransitions('SUBMITTED', 'buyer').map((t) => t.to)).toEqual(['WITHDRAWN']);
      // Expiry is the system's move, never a party's.
      expect(availableTransitions('SUBMITTED', 'system').map((t) => t.to)).toEqual(['EXPIRED']);
      expect(availableTransitions('DECLINED', 'buyer')).toEqual([]);
    });

    it('lets either party call off an accepted offer, while no money exists', () => {
      expect(canTransitionOffer('ACCEPTED', 'CANCELLED', 'buyer').allowed).toBe(true);
      expect(canTransitionOffer('ACCEPTED', 'CANCELLED', 'seller').allowed).toBe(true);
    });
  });

  describe('terminal statuses', () => {
    it('classifies the settled statuses and no others', () => {
      expect(isTerminal('DECLINED')).toBe(true);
      expect(isTerminal('EXPIRED')).toBe(true);
      expect(isTerminal('SUBMITTED')).toBe(false);
      expect(isTerminal('DRAFT')).toBe(false);
      // ACCEPTED is deliberately not terminal: until Phase 7 attaches money,
      // an accepted deal that falls through must be expressible.
      expect(isTerminal('ACCEPTED')).toBe(false);
    });
  });

  describe('expiry', () => {
    const now = new Date('2026-09-12T12:00:00.000Z');

    it('defaults to the documented window', () => {
      expect(offerExpiryFrom(now).getTime() - now.getTime()).toBe(
        DEFAULT_OFFER_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
    });

    it('clamps a window rather than trusting the caller', () => {
      expect(offerExpiryFrom(now, 9999).getTime() - now.getTime()).toBe(
        MAX_OFFER_TTL_DAYS * 24 * 60 * 60 * 1000,
      );
      expect(offerExpiryFrom(now, 0).getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
      expect(offerExpiryFrom(now, -5).getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('expires only an offer still awaiting an answer', () => {
      const past = new Date(now.getTime() - 1);
      const future = new Date(now.getTime() + 1);

      expect(hasExpired('SUBMITTED', past, now)).toBe(true);
      expect(hasExpired('SUBMITTED', future, now)).toBe(false);
      // An accepted offer does not evaporate because its original window
      // elapsed; the agreement already happened.
      expect(hasExpired('ACCEPTED', past, now)).toBe(false);
      expect(hasExpired('DECLINED', past, now)).toBe(false);
    });

    it('expires exactly at the boundary', () => {
      expect(hasExpired('SUBMITTED', now, now)).toBe(true);
    });
  });
});

/**
 * Amount rules.
 *
 * Integer `bigint` minor units throughout. Every bound comes from the listing
 * and its category, never from the request (ADR-0006).
 */
describe('offer amounts', () => {
  const listing = {
    listingPriceMinor: 100_000n,
    listingCurrency: 'GBP',
    categoryMinimumMinor: null,
  };

  it('accepts a plain integer minor-unit string', () => {
    const result = validateOfferAmount({ amountMinor: '90000', currency: 'GBP', ...listing });
    expect(result).toEqual({ ok: true, amountMinor: 90_000n, currency: 'GBP' });
  });

  it('keeps precision above Number.MAX_SAFE_INTEGER', () => {
    // The reason money crosses the wire as a string: 9007199254740993 is not
    // representable as a JSON number, and a float would round it.
    const huge = '9007199254740993';
    const result = validateOfferAmount({
      amountMinor: huge,
      currency: 'GBP',
      listingPriceMinor: null,
      listingCurrency: 'GBP',
      categoryMinimumMinor: null,
    });
    expect(result).toEqual({ ok: false, issue: 'too_large' });
    // …and the value itself survived the trip intact, unlike Number(huge).
    expect(BigInt(huge).toString()).toBe(huge);
    expect(String(Number(huge))).not.toBe(huge);
  });

  const refusals: [string, string, string][] = [
    ['a decimal string', '900.50', 'not_an_integer'],
    ['scientific notation', '9e4', 'not_an_integer'],
    ['a negative amount', '-90000', 'not_an_integer'],
    ['a leading plus', '+90000', 'not_an_integer'],
    ['whitespace padding', ' 90000 ', 'not_an_integer'],
    ['an empty string', '', 'not_an_integer'],
    ['a hex literal', '0x1F', 'not_an_integer'],
    ['zero', '0', 'not_positive'],
  ];

  for (const [name, amountMinor, issue] of refusals) {
    it(`refuses ${name}`, () => {
      expect(validateOfferAmount({ amountMinor, currency: 'GBP', ...listing })).toEqual({
        ok: false,
        issue,
      });
    });
  }

  it('refuses an amount past the hard ceiling', () => {
    expect(
      validateOfferAmount({
        amountMinor: (MAX_OFFER_MINOR + 1n).toString(),
        currency: 'GBP',
        ...listing,
      }),
    ).toEqual({ ok: false, issue: 'too_large' });

    expect(
      validateOfferAmount({
        amountMinor: MAX_OFFER_MINOR.toString(),
        currency: 'GBP',
        ...listing,
      }).ok,
    ).toBe(true);
  });

  it('refuses a currency the listing is not priced in', () => {
    // Comparing amounts across currencies without a recorded rate is how money
    // goes missing.
    expect(validateOfferAmount({ amountMinor: '90000', currency: 'USD', ...listing })).toEqual({
      ok: false,
      issue: 'currency_mismatch',
    });
  });

  it('compares currency case-insensitively but stores it normalised', () => {
    const result = validateOfferAmount({ amountMinor: '90000', currency: 'gbp', ...listing });
    expect(result).toEqual({ ok: true, amountMinor: 90_000n, currency: 'GBP' });
  });

  it('enforces the category floor when the category sets one', () => {
    expect(
      validateOfferAmount({
        amountMinor: '4999',
        currency: 'GBP',
        listingPriceMinor: 100_000n,
        listingCurrency: 'GBP',
        categoryMinimumMinor: 5_000n,
      }),
    ).toEqual({ ok: false, issue: 'below_minimum' });

    expect(
      validateOfferAmount({
        amountMinor: '5000',
        currency: 'GBP',
        listingPriceMinor: 100_000n,
        listingCurrency: 'GBP',
        categoryMinimumMinor: 5_000n,
      }).ok,
    ).toBe(true);
  });

  it('allows bidding above the asking price by default', () => {
    // Refusing this would be the marketplace deciding a seller should earn less.
    expect(
      validateOfferAmount({ amountMinor: '150000', currency: 'GBP', ...listing }).ok,
    ).toBe(true);
  });

  it('refuses above asking only where a category forbids it', () => {
    expect(
      validateOfferAmount({
        amountMinor: '150000',
        currency: 'GBP',
        allowAboveAsking: false,
        ...listing,
      }),
    ).toEqual({ ok: false, issue: 'above_listing_price' });
  });
});
