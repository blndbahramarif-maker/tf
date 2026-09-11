'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { FormError, FormField, FormNotice, inputClass } from '../../_components/form-field';
import { SubmitButton } from '../../_components/submit-button';
import { loginAction, registerAction, verifyEmailAction } from './actions';
import { EMPTY_FORM_STATE, type AuthFormState } from './form-state';

/**
 * Auth forms.
 *
 * Client components only so that `useActionState` can render the server's
 * error beside the fields. No authentication material is handled here: the
 * action writes HttpOnly cookies server-side, and the state that comes back
 * carries a message and nothing else.
 *
 * Error text is resolved through the message catalogue by KEY, so the server
 * never sends display copy and a failure reads correctly in Sorani.
 */

function useErrorText() {
  const t = useTranslations('auth.errors');
  return (error: string | null): string | null => {
    if (error === null) return null;
    // Known codes get real copy; anything else falls back rather than
    // rendering a raw server string at the user.
    const known = ['unauthenticated', 'forbidden', 'conflict', 'validation_failed', 'rate_limited'];
    return known.includes(error) ? t(error) : t('unknown');
  };
}

export function LoginForm({ locale, next }: { locale: string; next?: string }) {
  const t = useTranslations('auth.login');
  const [state, action] = useActionState<AuthFormState, FormData>(loginAction, EMPTY_FORM_STATE);
  const errorText = useErrorText();
  const message = errorText(state.error);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {message ? <FormError>{message}</FormError> : null}

      <FormField name="email" label={t('email')}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
        />
      </FormField>

      <FormField name="password" label={t('password')}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </FormField>

      <FormField name="totpCode" label={t('totpCode')} hint={t('totpHint')}>
        <input
          id="totpCode"
          name="totpCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          className={inputClass}
        />
      </FormField>

      <SubmitButton pendingLabel={t('submitting')}>{t('submit')}</SubmitButton>
    </form>
  );
}

export function RegisterForm({ locale }: { locale: string }) {
  const t = useTranslations('auth.register');
  const [state, action] = useActionState<AuthFormState, FormData>(registerAction, EMPTY_FORM_STATE);
  const errorText = useErrorText();
  const message = errorText(state.error);

  if (state.pendingVerification) {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice>{t('checkEmail')}</FormNotice>
        {/*
          Only present outside production, where the register endpoint returns
          the token so the flow can be completed without a mailbox. It is
          labelled as a development aid so nobody mistakes it for a feature.
        */}
        {state.devVerificationToken ? (
          <div className="border-border rounded-md border p-3">
            <p className="text-ink-muted text-xs font-medium uppercase">{t('devOnly')}</p>
            <p className="mt-1 font-mono text-xs break-all" data-testid="dev-verification-token">
              {state.devVerificationToken}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      {message ? <FormError>{message}</FormError> : null}

      <FormField name="displayName" label={t('displayName')}>
        <input
          id="displayName"
          name="displayName"
          required
          minLength={2}
          maxLength={120}
          className={inputClass}
        />
      </FormField>

      <FormField name="email" label={t('email')}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
        />
      </FormField>

      <FormField name="password" label={t('password')} hint={t('passwordHint')}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={inputClass}
        />
      </FormField>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="acceptedTerms"
          required
          className="accent-accent mt-0.5 size-4"
        />
        <span>{t('acceptTerms')}</span>
      </label>

      <SubmitButton pendingLabel={t('submitting')}>{t('submit')}</SubmitButton>
    </form>
  );
}

export function VerifyEmailForm({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations('auth.verify');
  const [state, action] = useActionState<AuthFormState, FormData>(
    verifyEmailAction,
    EMPTY_FORM_STATE,
  );
  const errorText = useErrorText();
  const message = errorText(state.error);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      {message ? <FormError>{message}</FormError> : null}

      <FormField name="token" label={t('token')} hint={t('tokenHint')}>
        <input id="token" name="token" required defaultValue={token} className={inputClass} />
      </FormField>

      <SubmitButton pendingLabel={t('submitting')}>{t('submit')}</SubmitButton>
    </form>
  );
}
