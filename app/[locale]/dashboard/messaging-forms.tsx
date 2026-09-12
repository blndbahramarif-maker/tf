'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { FormError, FormField, FormNotice, inputClass } from '../../_components/form-field';
import { SubmitButton } from '../../_components/submit-button';
import {
  createOfferAction,
  markReadAction,
  reportConversationAction,
  sendMessageAction,
  startConversationAction,
  transitionOfferAction,
} from './messaging-actions';
import { EMPTY_MESSAGING_STATE, type MessagingActionState } from './messaging-action-state';

/**
 * Messaging and offer forms.
 *
 * Every one renders a hidden `_csrf` field, bound by HMAC to the session, and
 * the action refuses without it. Ids also travel in hidden fields, and that is
 * fine: the server treats them as lookup keys and proves participation against
 * the database. Editing one in devtools returns `not_found`, exactly as a
 * made-up id does.
 *
 * These are plain forms with a server action, so they work without JavaScript.
 * The only thing JS adds is the pending state on the button.
 */

/**
 * Turns an action result into one sentence.
 *
 * A domain `reason` is preferred over the generic error when we have a
 * translation for it, because "That message is too long" is useful and
 * "Something went wrong" is not.
 */
function useActionMessage() {
  const tErrors = useTranslations('dashboard.errors');
  const tReasons = useTranslations('messaging.reasons');

  return (state: MessagingActionState): string | null => {
    if (state.error === null) return null;
    if (state.reason) {
      const key = `messaging.reasons.${state.reason}`;
      const translated = tReasons(state.reason);
      // next-intl echoes the full path when a key is missing; fall through to
      // the generic error rather than showing the user a dotted key path.
      if (translated !== key && translated !== state.reason) return translated;
    }
    return tErrors(state.error);
  };
}

function CsrfAndLocale({ csrfToken, locale }: { csrfToken: string; locale: string }) {
  return (
    <>
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );
}

/** "Contact seller" on a listing page. Opens or reuses the thread. */
export function ContactSellerForm({
  listingId,
  csrfToken,
  locale,
}: {
  listingId: string;
  csrfToken: string;
  locale: string;
}) {
  const [state, action] = useActionState(startConversationAction, EMPTY_MESSAGING_STATE);
  const t = useTranslations('messaging.contact');
  const message = useActionMessage();
  const error = message(state);

  return (
    <form action={action} className="flex flex-col gap-3">
      <CsrfAndLocale csrfToken={csrfToken} locale={locale} />
      <input type="hidden" name="listingId" value={listingId} />

      {error ? <FormError>{error}</FormError> : null}

      <FormField name="body" label={t('label')} hint={t('hint')}>
        <textarea
          id="body"
          name="body"
          rows={4}
          required
          maxLength={4000}
          dir="auto"
          defaultValue={t('placeholder')}
          className={inputClass}
        />
      </FormField>

      <div>
        <SubmitButton pendingLabel={t('sending')}>{t('submit')}</SubmitButton>
      </div>
    </form>
  );
}

/** The composer at the foot of a thread. */
export function SendMessageForm({
  conversationId,
  csrfToken,
  locale,
  disabled,
}: {
  conversationId: string;
  csrfToken: string;
  locale: string;
  disabled?: boolean;
}) {
  const [state, action] = useActionState(sendMessageAction, EMPTY_MESSAGING_STATE);
  const t = useTranslations('messaging.compose');
  const message = useActionMessage();
  const error = message(state);

  if (disabled) {
    return <FormNotice>{t('closed')}</FormNotice>;
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <CsrfAndLocale csrfToken={csrfToken} locale={locale} />
      <input type="hidden" name="conversationId" value={conversationId} />

      {error ? <FormError>{error}</FormError> : null}

      <FormField name="body" label={t('label')}>
        <textarea
          id="body"
          name="body"
          rows={3}
          required
          maxLength={4000}
          dir="auto"
          className={inputClass}
          placeholder={t('placeholder')}
        />
      </FormField>

      <div>
        <SubmitButton pendingLabel={t('sending')}>{t('submit')}</SubmitButton>
      </div>
    </form>
  );
}

/** Marks the open thread read. Rendered only when something is unread. */
export function MarkReadForm({
  conversationId,
  csrfToken,
  locale,
}: {
  conversationId: string;
  csrfToken: string;
  locale: string;
}) {
  const [, action] = useActionState(markReadAction, EMPTY_MESSAGING_STATE);
  const t = useTranslations('messaging.thread');

  return (
    <form action={action}>
      <CsrfAndLocale csrfToken={csrfToken} locale={locale} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <SubmitButton variant="secondary" pendingLabel={t('marking')}>
        {t('markRead')}
      </SubmitButton>
    </form>
  );
}

const REPORT_REASONS = [
  'spam',
  'scam',
  'harassment',
  'off_platform_payment',
  'illegal_goods',
  'other',
] as const;

export function ReportConversationForm({
  conversationId,
  csrfToken,
  locale,
  alreadyReported,
}: {
  conversationId: string;
  csrfToken: string;
  locale: string;
  alreadyReported: boolean;
}) {
  const [state, action] = useActionState(reportConversationAction, EMPTY_MESSAGING_STATE);
  const t = useTranslations('messaging.report');
  const message = useActionMessage();
  const error = message(state);

  if (alreadyReported || state.ok) {
    // Reporting deletes nothing: the thread and its messages stay exactly as
    // they were, so a reviewer has the evidence the report was raised about.
    return <FormNotice>{t('received')}</FormNotice>;
  }

  return (
    <details className="border-border rounded-[--radius-card] border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('title')}</summary>

      <form action={action} className="mt-4 flex flex-col gap-3">
        <CsrfAndLocale csrfToken={csrfToken} locale={locale} />
        <input type="hidden" name="conversationId" value={conversationId} />

        {error ? <FormError>{error}</FormError> : null}

        <FormField name="reasonCode" label={t('reason')}>
          <select id="reasonCode" name="reasonCode" required className={inputClass}>
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`reasons.${reason}`)}
              </option>
            ))}
          </select>
        </FormField>

        <FormField name="details" label={t('details')} hint={t('detailsHint')}>
          <textarea
            id="details"
            name="details"
            rows={3}
            maxLength={2000}
            dir="auto"
            className={inputClass}
          />
        </FormField>

        <div>
          <SubmitButton variant="danger" pendingLabel={t('sending')}>
            {t('submit')}
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}

/** Make an offer, from a listing page or from inside a thread. */
export function MakeOfferForm({
  listingId,
  conversationId,
  currency,
  suggestedAmount,
  csrfToken,
  locale,
}: {
  listingId: string;
  conversationId?: string;
  currency: string;
  /** The asking price, in major units, as a starting point — not a floor. */
  suggestedAmount?: string;
  csrfToken: string;
  locale: string;
}) {
  const [state, action] = useActionState(createOfferAction, EMPTY_MESSAGING_STATE);
  const t = useTranslations('messaging.offerForm');
  const message = useActionMessage();
  const error = message(state);

  return (
    <form action={action} className="flex flex-col gap-3">
      <CsrfAndLocale csrfToken={csrfToken} locale={locale} />
      <input type="hidden" name="listingId" value={listingId} />
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      {/* The currency is the LISTING's; the server re-reads it and refuses a
          mismatch, so this field is a convenience and never an authority. */}
      <input type="hidden" name="currency" value={currency} />

      {error ? <FormError>{error}</FormError> : null}

      <FormField name="amount" label={t('amount', { currency })} hint={t('amountHint')}>
        <input
          id="amount"
          name="amount"
          type="text"
          inputMode="decimal"
          required
          defaultValue={suggestedAmount}
          className={inputClass}
        />
      </FormField>

      <FormField name="message" label={t('message')}>
        <textarea
          id="message"
          name="message"
          rows={3}
          maxLength={4000}
          dir="auto"
          className={inputClass}
        />
      </FormField>

      <div>
        <SubmitButton pendingLabel={t('sending')}>{t('submit')}</SubmitButton>
      </div>

      <p className="text-ink-muted text-xs">{t('noPayment')}</p>
    </form>
  );
}

/**
 * The moves available to this viewer on this offer.
 *
 * The list is rendered from what the SERVER said is available, computed from
 * the transition table for the viewer's database-resolved role. The client
 * never decides; submitting a move the table does not grant this actor is
 * refused with a conflict.
 */
export function OfferActions({
  offerId,
  transitions,
  csrfToken,
  locale,
}: {
  offerId: string;
  transitions: readonly { to: string; description: string }[];
  csrfToken: string;
  locale: string;
}) {
  const [state, action] = useActionState(transitionOfferAction, EMPTY_MESSAGING_STATE);
  const t = useTranslations('messaging.offerActions');
  const message = useActionMessage();
  const error = message(state);

  if (transitions.length === 0) {
    return <p className="text-ink-muted text-sm">{t('none')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <FormError>{error}</FormError> : null}

      <div className="flex flex-wrap gap-2">
        {transitions.map((transition) => (
          <form key={transition.to} action={action}>
            <CsrfAndLocale csrfToken={csrfToken} locale={locale} />
            <input type="hidden" name="offerId" value={offerId} />
            <input type="hidden" name="to" value={transition.to} />
            <SubmitButton
              variant={transition.to === 'ACCEPTED' ? 'primary' : 'secondary'}
              pendingLabel={t('working')}
            >
              {t(`to.${transition.to}`)}
            </SubmitButton>
          </form>
        ))}
      </div>
    </div>
  );
}
