'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { FormError, FormField, FormNotice, inputClass } from '../../_components/form-field';
import { SubmitButton } from '../../_components/submit-button';
import {
  createListingAction,
  deleteListingImageAction,
  transitionListingAction,
  updateListingAction,
  updateSellerProfileAction,
} from './actions';
import { EMPTY_ACTION_STATE, type ActionState } from './action-state';

/**
 * Dashboard forms.
 *
 * Each renders a hidden `_csrf` field. That token is bound by HMAC to the
 * session, so it cannot be lifted onto another user's request, and the action
 * refuses without it.
 *
 * The listing id also travels in a hidden field. That is fine, and is the
 * point of the ownership check: the server treats it as a lookup key and then
 * proves the row belongs to the caller. Editing this field in devtools gets
 * `not_found`, the same answer as a listing that does not exist.
 */

function useActionError() {
  const t = useTranslations('dashboard.errors');
  return (state: ActionState): string | null => (state.error === null ? null : t(state.error));
}

export interface AttributeInput {
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly unit: string | null;
  readonly isRequired: boolean;
  readonly options: readonly { value: string; label: string }[];
  readonly value?: string;
}

function AttributeFields({
  attributes,
  fieldErrors,
}: {
  attributes: readonly AttributeInput[];
  fieldErrors?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('dashboard.listingForm');

  return (
    <>
      {attributes.map((attribute) => {
        const name = `attr.${attribute.key}`;
        const error = fieldErrors?.[name];
        const label = attribute.unit ? `${attribute.label} (${attribute.unit})` : attribute.label;

        return (
          <FormField
            key={attribute.key}
            name={name}
            label={attribute.isRequired ? `${label} *` : label}
            error={error ? t(`attributeError.${error}`) : null}
          >
            {attribute.options.length > 0 ? (
              <select
                id={name}
                name={name}
                defaultValue={attribute.value ?? ''}
                required={attribute.isRequired}
                className={inputClass}
              >
                <option value="">{t('choose')}</option>
                {attribute.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={name}
                name={name}
                defaultValue={attribute.value ?? ''}
                required={attribute.isRequired}
                inputMode={
                  attribute.dataType === 'INTEGER' || attribute.dataType === 'NUMBER'
                    ? 'numeric'
                    : undefined
                }
                type={attribute.dataType === 'DATE' ? 'date' : 'text'}
                dir="auto"
                className={inputClass}
              />
            )}
          </FormField>
        );
      })}
    </>
  );
}

export function CreateListingForm({
  locale,
  csrfToken,
  categorySlug,
  attributes,
}: {
  locale: string;
  csrfToken: string;
  categorySlug: string;
  attributes: readonly AttributeInput[];
}) {
  const t = useTranslations('dashboard.listingForm');
  const [state, action] = useActionState<ActionState, FormData>(
    createListingAction,
    EMPTY_ACTION_STATE,
  );
  const errorText = useActionError();
  const message = errorText(state);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="categorySlug" value={categorySlug} />
      <input type="hidden" name="countryCode" value="GB" />

      {message ? <FormError>{message}</FormError> : null}

      <FormField
        name="title"
        label={t('title')}
        error={state.fieldErrors?.title ? t('titleError') : null}
      >
        <input
          id="title"
          name="title"
          required
          minLength={3}
          maxLength={140}
          dir="auto"
          className={inputClass}
        />
      </FormField>

      <FormField
        name="description"
        label={t('description')}
        error={state.fieldErrors?.description ? t('descriptionError') : null}
      >
        <textarea
          id="description"
          name="description"
          required
          minLength={10}
          maxLength={10000}
          rows={6}
          dir="auto"
          className={inputClass}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          name="priceMinor"
          label={t('priceMinor')}
          hint={t('priceHint')}
          error={
            state.fieldErrors?.priceMinor ? t(`priceError.${state.fieldErrors.priceMinor}`) : null
          }
        >
          <input id="priceMinor" name="priceMinor" inputMode="numeric" className={inputClass} />
        </FormField>

        <FormField name="priceType" label={t('priceType')}>
          <select id="priceType" name="priceType" defaultValue="FIXED" className={inputClass}>
            {['FIXED', 'NEGOTIABLE', 'ON_REQUEST', 'FREE'].map((value) => (
              <option key={value} value={value}>
                {t(`priceTypes.${value}`)}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField name="condition" label={t('condition')}>
        <select id="condition" name="condition" defaultValue="GOOD" className={inputClass}>
          {['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'FOR_PARTS', 'NOT_APPLICABLE'].map((value) => (
            <option key={value} value={value}>
              {t(`conditions.${value}`)}
            </option>
          ))}
        </select>
      </FormField>

      <AttributeFields attributes={attributes} fieldErrors={state.fieldErrors} />

      <SubmitButton pendingLabel={t('creating')}>{t('create')}</SubmitButton>
    </form>
  );
}

export function EditListingForm({
  locale,
  csrfToken,
  listingId,
  attributes,
  defaults,
  editable,
}: {
  locale: string;
  csrfToken: string;
  listingId: string;
  attributes: readonly AttributeInput[];
  defaults: {
    title: string;
    description: string;
    priceMinor: string;
    priceType: string;
    condition: string;
  };
  editable: boolean;
}) {
  const t = useTranslations('dashboard.listingForm');
  const [state, action] = useActionState<ActionState, FormData>(
    updateListingAction,
    EMPTY_ACTION_STATE,
  );
  const errorText = useActionError();
  const message = errorText(state);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="listingId" value={listingId} />

      {message ? <FormError>{message}</FormError> : null}
      {state.ok ? <FormNotice>{t('saved')}</FormNotice> : null}
      {editable ? null : <FormNotice>{t('pauseToEdit')}</FormNotice>}

      <fieldset disabled={!editable} className="flex flex-col gap-5">
        <FormField name="title" label={t('title')}>
          <input
            id="title"
            name="title"
            required
            defaultValue={defaults.title}
            dir="auto"
            className={inputClass}
          />
        </FormField>

        <FormField name="description" label={t('description')}>
          <textarea
            id="description"
            name="description"
            required
            rows={6}
            defaultValue={defaults.description}
            dir="auto"
            className={inputClass}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField name="priceMinor" label={t('priceMinor')} hint={t('priceHint')}>
            <input
              id="priceMinor"
              name="priceMinor"
              inputMode="numeric"
              defaultValue={defaults.priceMinor}
              className={inputClass}
            />
          </FormField>
          <FormField name="priceType" label={t('priceType')}>
            <select
              id="priceType"
              name="priceType"
              defaultValue={defaults.priceType}
              className={inputClass}
            >
              {['FIXED', 'NEGOTIABLE', 'ON_REQUEST', 'FREE'].map((value) => (
                <option key={value} value={value}>
                  {t(`priceTypes.${value}`)}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField name="condition" label={t('condition')}>
          <select
            id="condition"
            name="condition"
            defaultValue={defaults.condition}
            className={inputClass}
          >
            {['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'FOR_PARTS', 'NOT_APPLICABLE'].map((value) => (
              <option key={value} value={value}>
                {t(`conditions.${value}`)}
              </option>
            ))}
          </select>
        </FormField>

        <AttributeFields attributes={attributes} fieldErrors={state.fieldErrors} />

        <SubmitButton pendingLabel={t('saving')}>{t('save')}</SubmitButton>
      </fieldset>
    </form>
  );
}

export function TransitionForm({
  locale,
  csrfToken,
  listingId,
  to,
  label,
  variant = 'secondary',
}: {
  locale: string;
  csrfToken: string;
  listingId: string;
  to: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const t = useTranslations('dashboard.listingForm');
  const [state, action] = useActionState<ActionState, FormData>(
    transitionListingAction,
    EMPTY_ACTION_STATE,
  );
  const errorText = useActionError();
  const message = errorText(state);

  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="to" value={to} />
      <SubmitButton pendingLabel={t('working')} variant={variant}>
        {label}
      </SubmitButton>
      {message ? <span className="text-danger text-xs">{message}</span> : null}
    </form>
  );
}

export function DeleteImageForm({
  locale,
  csrfToken,
  listingId,
  imageId,
  label,
}: {
  locale: string;
  csrfToken: string;
  listingId: string;
  imageId: string;
  label: string;
}) {
  const t = useTranslations('dashboard.listingForm');
  const [, action] = useActionState<ActionState, FormData>(
    deleteListingImageAction,
    EMPTY_ACTION_STATE,
  );

  return (
    <form action={action}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="imageId" value={imageId} />
      <button type="submit" className="text-danger text-xs underline" aria-label={label}>
        {t('removeImage')}
      </button>
    </form>
  );
}

export function SellerProfileForm({
  locale,
  csrfToken,
  defaults,
}: {
  locale: string;
  csrfToken: string;
  defaults: { displayName: string; about: string };
}) {
  const t = useTranslations('dashboard.profile');
  const [state, action] = useActionState<ActionState, FormData>(
    updateSellerProfileAction,
    EMPTY_ACTION_STATE,
  );
  const errorText = useActionError();
  const message = errorText(state);

  return (
    <form action={action} className="flex max-w-xl flex-col gap-5">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="locale" value={locale} />

      {message ? <FormError>{message}</FormError> : null}
      {state.ok ? <FormNotice>{t('saved')}</FormNotice> : null}

      <FormField
        name="displayName"
        label={t('displayName')}
        error={state.fieldErrors?.displayName ? t('displayNameError') : null}
      >
        <input
          id="displayName"
          name="displayName"
          required
          minLength={2}
          maxLength={120}
          defaultValue={defaults.displayName}
          dir="auto"
          className={inputClass}
        />
      </FormField>

      <FormField name="about" label={t('about')}>
        <textarea
          id="about"
          name="about"
          rows={5}
          maxLength={2000}
          defaultValue={defaults.about}
          dir="auto"
          className={inputClass}
        />
      </FormField>

      <SubmitButton pendingLabel={t('saving')}>{t('save')}</SubmitButton>
    </form>
  );
}
