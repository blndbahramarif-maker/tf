'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { brand } from '@kurdora/brand';
import { FormError, FormNotice } from '../../../_components/form-field';
import { SubmitButton } from '../../../_components/submit-button';
import { refreshPayoutStatusAction, startPayoutOnboardingAction } from '../actions';
import { EMPTY_ACTION_STATE, type ActionState } from '../action-state';

/**
 * The two payout buttons.
 *
 * Both are forms rather than links, because both are state changes and both
 * must carry a CSRF token — a link cannot. Neither carries anything else: the
 * server reads the seller from the session and there is no field to forge.
 */

function useActionError() {
  const t = useTranslations('dashboard.errors');
  return (state: ActionState): string | null => (state.error === null ? null : t(state.error));
}

export function StartPayoutOnboardingForm({
  csrfToken,
  resuming,
}: {
  csrfToken: string;
  /** Changes only the label: "set up payouts" versus "finish setting up". */
  resuming: boolean;
}) {
  const t = useTranslations('dashboard.payouts');
  const [state, action] = useActionState(startPayoutOnboardingAction, EMPTY_ACTION_STATE);
  const errorFor = useActionError();
  const error = errorFor(state);

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="_csrf" value={csrfToken} />
      {error === null ? null : <FormError>{error}</FormError>}
      <SubmitButton pendingLabel={t('starting')}>
        {resuming ? t('resume') : t('start')}
      </SubmitButton>
      {/*
        Stated before they click, not after. A seller is about to be sent to a
        third party and asked for identity documents; who is asking, and why,
        is not a detail to discover on arrival.
      */}
      <p className="text-ink-muted mt-2 text-xs">{t('handoffNote', { brandName: brand.name })}</p>
    </form>
  );
}

export function RefreshPayoutStatusForm({ csrfToken }: { csrfToken: string }) {
  const t = useTranslations('dashboard.payouts');
  const [state, action] = useActionState(refreshPayoutStatusAction, EMPTY_ACTION_STATE);
  const errorFor = useActionError();
  const error = errorFor(state);

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="_csrf" value={csrfToken} />
      {error === null ? null : <FormError>{error}</FormError>}
      {state.ok ? <FormNotice>{t('refreshed')}</FormNotice> : null}
      <SubmitButton pendingLabel={t('refreshing')} variant="secondary">
        {t('refresh')}
      </SubmitButton>
    </form>
  );
}
