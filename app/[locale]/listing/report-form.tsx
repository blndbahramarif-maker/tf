'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { brand } from '@kurdora/brand';
import { FormError, FormNotice, inputClass } from '../../_components/form-field';
import { SubmitButton } from '../../_components/submit-button';
import { reportListingAction } from './report-action';
import { EMPTY_ACTION_STATE, type ActionState } from '../dashboard/action-state';

/**
 * Reporting a listing, from the listing page.
 *
 * Collapsed behind a link by default. Reporting matters, but putting a
 * permanent form under every listing invites idle clicking, and a queue full
 * of noise is a queue nobody reads.
 *
 * The listing id travels in a hidden field. That is fine and is the point of
 * the server-side lookup: it is a key, and the action restricts what it can
 * resolve to.
 */

const REASONS = [
  'prohibited_item',
  'counterfeit',
  'stolen_goods',
  'scam',
  'unsafe_or_illegal',
  'offensive',
  'wrong_category',
  'other',
] as const;

export function ReportListingForm({
  listingId,
  csrfToken,
}: {
  listingId: string;
  csrfToken: string;
}) {
  const t = useTranslations('listing.report');
  const errors = useTranslations('dashboard.errors');
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(reportListingAction, EMPTY_ACTION_STATE);

  const error = (state as ActionState).error;

  if (state.ok) {
    // Says only that it was received. Not that anything will be removed —
    // that is a moderator's decision, not a promise this form can make.
    return <FormNotice>{t('received')}</FormNotice>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-ink-muted hover:text-ink mt-4 text-xs underline underline-offset-2"
      >
        {t('open')}
      </button>
    );
  }

  return (
    <form action={action} className="border-border mt-4 border-t pt-4">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="listingId" value={listingId} />

      <p className="text-ink text-sm font-medium">{t('title')}</p>
      {error === null ? null : <FormError>{errors(error)}</FormError>}

      <label className="mt-3 block">
        <span className="text-ink-muted text-xs">{t('reason')}</span>
        <select name="reasonCode" required className={inputClass} defaultValue="">
          <option value="" disabled>
            {t('choose')}
          </option>
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(`reasons.${reason}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className="text-ink-muted text-xs">{t('details')}</span>
        <textarea name="details" rows={3} maxLength={2000} className={inputClass} />
      </label>

      <div className="mt-3 flex items-center gap-3">
        <SubmitButton pendingLabel={t('sending')} variant="secondary">
          {t('send')}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink text-xs underline underline-offset-2"
        >
          {t('cancel')}
        </button>
      </div>

      {/* Stated plainly, because the alternative is someone assuming a report
          is an instant takedown and that Kurdora has vetted what remains. */}
      <p className="text-ink-muted mt-3 text-xs">{t('disclaimer', { brandName: brand.name })}</p>
    </form>
  );
}
