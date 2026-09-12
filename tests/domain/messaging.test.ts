import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_LENGTH,
  MAX_RAW_MESSAGE_BYTES,
  REVIEW_THRESHOLD,
  needsReview,
  scoreMessage,
  validateMessage,
} from '@/domain/messaging/message-content';

/**
 * Message content rules.
 *
 * Two things are being proved, and they pull against each other:
 *
 *   Nothing a sender writes can execute. The defence is that a message is
 *   never treated as markup at any point — so these tests assert that markup
 *   comes back UNCHANGED rather than stripped. A test expecting `<script>` to
 *   be removed would be testing a blocklist, and blocklists lose.
 *
 *   Nothing a sender writes is silently rewritten. A message that cannot be
 *   accepted is refused with a reason; a risky one is scored, not censored.
 */
describe('message validation', () => {
  describe('what is refused, and why', () => {
    it('refuses an empty message', () => {
      expect(validateMessage('')).toEqual({ ok: false, issue: 'only_whitespace' });
    });

    it('refuses whitespace pretending to be a message', () => {
      expect(validateMessage('   \n\n\t  ')).toEqual({ ok: false, issue: 'only_whitespace' });
    });

    it('refuses a message that is only control characters', () => {
      // Nothing survives stripping, so there was never any content — but the
      // raw input was not whitespace, and the issue says so.
      expect(validateMessage('\u0000\u0001\u0007')).toEqual({ ok: false, issue: 'empty' });
    });

    it('refuses an over-length message rather than truncating it', () => {
      // A message cut in half changes its meaning, and the sender is never
      // told. Refusal is the honest answer.
      expect(validateMessage('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toEqual({
        ok: false,
        issue: 'too_long',
      });
    });

    it('accepts a message exactly at the limit', () => {
      expect(validateMessage('a'.repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
    });

    it('refuses a megabyte before it ever reaches the normaliser', () => {
      // The byte guard runs first so the regex passes are never handed
      // something unbounded.
      expect(validateMessage('x'.repeat(MAX_RAW_MESSAGE_BYTES + 1))).toEqual({
        ok: false,
        issue: 'too_large',
      });
    });

    it('measures the byte guard in bytes, not characters', () => {
      // Each of these is 4 bytes of UTF-8 but 2 UTF-16 code units, so a
      // character count would let through roughly twice the intended size.
      const wide = '\u{1F600}'.repeat(Math.ceil(MAX_RAW_MESSAGE_BYTES / 4) + 1);
      expect(wide.length).toBeLessThan(MAX_RAW_MESSAGE_BYTES);
      expect(validateMessage(wide)).toEqual({ ok: false, issue: 'too_large' });
    });
  });

  describe('what is stored, verbatim', () => {
    it('stores markup exactly as written', () => {
      // The safety property is that this is never PARSED. Stripping it would
      // both break legitimate messages and give a false sense of security.
      const raw = '<script>alert(1)</script> is the code I meant';
      expect(validateMessage(raw)).toMatchObject({ ok: true, body: raw });
    });

    it('leaves quotes, ampersands and backslashes alone', () => {
      const raw = 'He said "it is 50% & final" -- <b>really</b> \\ ok';
      expect(validateMessage(raw)).toMatchObject({ ok: true, body: raw });
    });

    it('preserves Sorani and astral characters unchanged', () => {
      const raw = 'سڵاو، ئایا? \u{1F600}';
      expect(validateMessage(raw)).toMatchObject({ ok: true, body: raw });
    });

    it('keeps tabs and newlines, which are content', () => {
      expect(validateMessage('line one\n\tindented')).toMatchObject({
        ok: true,
        body: 'line one\n\tindented',
      });
    });

    it('does not linkify, mask or otherwise edit words', () => {
      const raw = 'Email me at sam@example.com or see https://example.com';
      // Scored, as the signals below show — but returned exactly as written.
      expect(validateMessage(raw)).toMatchObject({ ok: true, body: raw });
    });
  });

  describe('what is removed, and only this', () => {
    it('removes C0 and C1 control characters', () => {
      expect(validateMessage('before\u0000\u0007\u001B\u009Fafter')).toMatchObject({
        ok: true,
        body: 'beforeafter',
      });
    });

    it('removes bidi overrides that can disguise text', () => {
      // Trojan Source: an override can make a message render as something
      // other than what is stored, which is a phishing primitive.
      const result = validateMessage('Pay \u202Eevil\u202C now');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const body = result.body;
      expect(body).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
      // Removed, not censored: the word itself is still there.
      expect(body).toContain('evil');
    });

    it('normalises CRLF and collapses only excessive blank lines', () => {
      expect(validateMessage('one\r\ntwo\n\n\n\n\n\nthree')).toMatchObject({
        ok: true,
        body: 'one\ntwo\n\n\nthree',
      });
    });

    it('trims surrounding whitespace but not internal spacing', () => {
      expect(validateMessage('  hello   world  ')).toMatchObject({
        ok: true,
        body: 'hello   world',
      });
    });
  });

  describe('risk scoring', () => {
    it('scores, never blocks', () => {
      // Accepted despite scoring high: the message is delivered and marked for
      // a reviewer, not swallowed.
      expect(validateMessage('Pay by bank transfer, urgent, sam@example.com').ok).toBe(true);
    });

    it('flags an email address and a phone number as contact details', () => {
      expect(scoreMessage('reach me on sam@example.com').signals.map((s) => s.code)).toContain(
        'contact_details',
      );
      expect(scoreMessage('call +44 7700 900123').signals.map((s) => s.code)).toContain(
        'contact_details',
      );
    });

    it('flags off-platform payment steering', () => {
      expect(scoreMessage('send it by western union').signals.map((s) => s.code)).toContain(
        'payment_redirect',
      );
    });

    it('flags external links and urgency', () => {
      expect(scoreMessage('see https://elsewhere.test').signals.map((s) => s.code)).toContain(
        'external_link',
      );
      expect(scoreMessage('today only, last chance').signals.map((s) => s.code)).toContain(
        'urgency_pressure',
      );
    });

    it('leaves an ordinary enquiry unscored', () => {
      const result = scoreMessage('Hello, is the blue one still available?');
      expect(result.signals).toEqual([]);
      expect(result.score).toBe(0);
    });

    it('caps the score at 100 however many signals fire', () => {
      const everything =
        'urgent! pay by bitcoin at https://scam.test, email sam@example.com <b>now</b>';
      expect(scoreMessage(everything).score).toBeLessThanOrEqual(100);
      expect(scoreMessage(everything).signals.length).toBeGreaterThan(3);
    });

    it('routes a message to review only at the threshold', () => {
      expect(needsReview(REVIEW_THRESHOLD - 1)).toBe(false);
      expect(needsReview(REVIEW_THRESHOLD)).toBe(true);
    });

    it('scores the cleaned body, not the raw input', () => {
      // A sender cannot hide a signal behind control characters: the score is
      // computed after stripping, on what a reader will actually see.
      const hidden = validateMessage('bank\u0000 transfer please');
      expect(hidden.ok).toBe(true);
      // Narrowed rather than cast, so this cannot silently become a no-op if
      // the result shape ever changes.
      if (!hidden.ok) return;
      expect(hidden.body).toBe('bank transfer please');
      expect(hidden.signals.map((signal) => signal.code)).toContain('payment_redirect');
    });
  });
});
