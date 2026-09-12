/**
 * Message content rules.
 *
 * Two principles, and they pull in different directions:
 *
 *   1. A message must never be able to execute anything. Messages are stored
 *      and rendered as PLAIN TEXT. React escapes them on output, so there is
 *      no HTML parsing step to defeat — the defence is "never treat it as
 *      markup", not "strip the dangerous markup", because the second is a
 *      blocklist and blocklists lose.
 *
 *   2. We do not silently rewrite what a person wrote. No auto-linkifying, no
 *      profanity masking, no quiet truncation. A message that cannot be
 *      accepted is REFUSED with a reason; a message that looks risky is SCORED
 *      and routed to moderation. Editing someone's words without telling them
 *      is worse than either.
 *
 * So normalisation here is limited to what is genuinely not content: control
 * characters that corrupt rendering, and runs of blank lines.
 */

import {
  MAX_MESSAGE_LENGTH,
  MAX_RAW_MESSAGE_BYTES,
  MIN_MESSAGE_LENGTH,
} from '@/shared/messaging-contract';

export { MAX_MESSAGE_LENGTH, MAX_RAW_MESSAGE_BYTES, MIN_MESSAGE_LENGTH };

export type MessageIssue = 'empty' | 'too_long' | 'too_large' | 'only_whitespace';

export interface RiskSignal {
  readonly code: string;
  readonly weight: number;
}

export type MessageValidation =
  | {
      readonly ok: true;
      /** Stored verbatim apart from control-character removal. */
      readonly body: string;
      readonly riskScore: number;
      readonly signals: readonly RiskSignal[];
    }
  | { readonly ok: false; readonly issue: MessageIssue };

/**
 * Characters that are not content and can corrupt rendering or logs: C0/C1
 * controls except tab and newline.
 *
 * Built from code points rather than written as a literal class. A literal
 * would embed raw control characters in the source — invisible in a diff,
 * invisible in a review, and flagged by `no-control-regex` for exactly that
 * reason. Naming the ranges says what is removed and why.
 */
const CONTROL_RANGES: readonly [number, number][] = [
  [0x00, 0x08], // NUL..BS  (TAB 0x09 and LF 0x0a are content)
  [0x0b, 0x0c], // VT, FF
  [0x0e, 0x1f], // SO..US   (CR 0x0d is normalised separately)
  [0x7f, 0x9f], // DEL and C1
];

const CONTROL_CHARACTERS = new RegExp(
  `[${CONTROL_RANGES.map(
    ([from, to]) =>
      `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`,
  ).join('')}]`,
  'g',
);

const BIDI_OVERRIDES = new RegExp('[\\u202A-\\u202E\\u2066-\\u2069]', 'g');

function stripUnsafeCharacters(input: string): string {
  return input.replace(CONTROL_CHARACTERS, '').replace(BIDI_OVERRIDES, '');
}

function normaliseWhitespace(input: string): string {
  return input
    .replace(new RegExp('\\r\\n', 'g'), '\n')
    .replace(new RegExp('\\n{4,}', 'g'), '\n\n\n')
    .trim();
}

/**
 * Risk signals.
 *
 * These SCORE a message; they never block or alter it. A high score marks the
 * conversation for a human once the moderation queue exists. A false positive
 * costs a reviewer a few seconds; silently eating a legitimate message costs a
 * sale and the user's trust.
 */
const SIGNAL_RULES: readonly { code: string; weight: number; test: (body: string) => boolean }[] = [
  {
    // Steering a deal off-platform is the most common vector for both scams
    // and fee avoidance, so it is weighted highest alongside payment redirects.
    code: 'contact_details',
    weight: 30,
    test: (body) =>
      /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/.test(body) ||
      /(?:\+\d[\d\s().-]{7,}|\b0\d[\d\s().-]{8,})/.test(body),
  },
  {
    code: 'external_link',
    weight: 20,
    test: (body) => /\b(?:https?:\/\/|www\.)\S+/i.test(body),
  },
  {
    code: 'payment_redirect',
    weight: 35,
    test: (body) =>
      /\b(?:western union|moneygram|bank transfer|wire transfer|gift card|crypto|bitcoin|usdt)\b/i.test(
        body,
      ),
  },
  {
    code: 'urgency_pressure',
    weight: 10,
    test: (body) => /\b(?:urgent|today only|right now|immediately|last chance)\b/i.test(body),
  },
  {
    // Looks like markup. Harmless to us — we never parse it — but a message
    // full of tags is worth a reviewer's attention.
    code: 'markup_like',
    weight: 15,
    test: (body) => /<\s*\/?\s*[a-z][\s\S]*?>/i.test(body),
  },
];

export function scoreMessage(body: string): { score: number; signals: RiskSignal[] } {
  const signals: RiskSignal[] = [];
  for (const rule of SIGNAL_RULES) {
    if (rule.test(body)) signals.push({ code: rule.code, weight: rule.weight });
  }
  const score = Math.min(
    100,
    signals.reduce((total, signal) => total + signal.weight, 0),
  );
  return { score, signals };
}

export function validateMessage(raw: string): MessageValidation {
  if (Buffer.byteLength(raw, 'utf8') > MAX_RAW_MESSAGE_BYTES) {
    return { ok: false, issue: 'too_large' };
  }

  const cleaned = normaliseWhitespace(stripUnsafeCharacters(raw));

  if (cleaned.length === 0) {
    return { ok: false, issue: raw.trim().length === 0 ? 'only_whitespace' : 'empty' };
  }
  if (cleaned.length < MIN_MESSAGE_LENGTH) return { ok: false, issue: 'empty' };
  // Refused, not truncated: a message cut in half changes its meaning.
  if (cleaned.length > MAX_MESSAGE_LENGTH) return { ok: false, issue: 'too_long' };

  const { score, signals } = scoreMessage(cleaned);
  return { ok: true, body: cleaned, riskScore: score, signals };
}

/** Score at which a conversation is flagged for review. */
export const REVIEW_THRESHOLD = 50;

export function needsReview(score: number): boolean {
  return score >= REVIEW_THRESHOLD;
}
