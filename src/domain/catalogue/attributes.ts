/**
 * Category-specific attribute validation.
 *
 * Listings carry whatever fields their category defines — mileage and fuel type
 * for Cars, storage and warranty for Mobile & Electronics. Those definitions
 * live in the database and are editable by an admin, so this module validates
 * submitted values against DEFINITIONS PASSED IN, never against a hard-coded
 * schema and never against a category name.
 *
 * Output is deliberately two-shaped, matching the hybrid storage model
 * (docs/03-database-architecture.md):
 *
 *   `rows` — one typed row per value, for referential integrity and admin edit
 *   `json` — a flat projection, GIN-indexed, for fast faceted filtering
 *
 * Both are written in the same transaction. The rows are the source of truth;
 * the JSON is a derived read model.
 */

export type AttributeDataType =
  'TEXT' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM' | 'DATE';

export interface AttributeOptionDefinition {
  readonly id: string;
  readonly value: string;
}

export interface AttributeValidation {
  readonly min?: number;
  readonly max?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Anchored server-side before use; see `matchesPattern`. */
  readonly pattern?: string;
}

export interface AttributeDefinition {
  readonly id: string;
  readonly key: string;
  readonly dataType: AttributeDataType;
  readonly isRequired: boolean;
  readonly unit?: string | null;
  readonly validation: AttributeValidation;
  readonly options: readonly AttributeOptionDefinition[];
}

/** One normalised row, mapping to `listing_attribute_values`. */
export interface AttributeValueRow {
  readonly attributeDefinitionId: string;
  readonly key: string;
  readonly valueText: string | null;
  readonly valueNumber: string | null;
  readonly valueInteger: bigint | null;
  readonly valueBoolean: boolean | null;
  readonly valueDate: Date | null;
  readonly optionId: string | null;
}

export interface AttributeIssue {
  readonly key: string;
  readonly code:
    | 'required'
    | 'unknown_attribute'
    | 'wrong_type'
    | 'not_an_option'
    | 'out_of_range'
    | 'too_long'
    | 'too_short'
    | 'pattern_mismatch'
    | 'not_a_date'
    | 'empty_selection';
  readonly message: string;
}

export type AttributeValidationResult =
  | {
      readonly ok: true;
      readonly rows: readonly AttributeValueRow[];
      /** Flat projection for `listings.attributes`. */
      readonly json: Record<string, unknown>;
    }
  | { readonly ok: false; readonly issues: readonly AttributeIssue[] };

const MAX_TEXT_LENGTH = 500;

function emptyRow(
  definition: AttributeDefinition,
): Omit<AttributeValueRow, 'key'> & { key: string } {
  return {
    attributeDefinitionId: definition.id,
    key: definition.key,
    valueText: null,
    valueNumber: null,
    valueInteger: null,
    valueBoolean: null,
    valueDate: null,
    optionId: null,
  };
}

/**
 * Applies a validation pattern safely.
 *
 * The pattern is admin-supplied, so it is anchored and length-capped, and the
 * input is bounded before matching. An unanchored admin regex over unbounded
 * input is a denial-of-service waiting to happen.
 */
function matchesPattern(pattern: string, value: string): boolean {
  if (pattern.length > 200) return false;
  try {
    return new RegExp(`^(?:${pattern})$`, 'u').test(value);
  } catch {
    // A malformed stored pattern must not reject every listing silently, nor
    // throw into the request. Treat it as "no constraint" and let admin
    // validation catch it separately.
    return true;
  }
}

/**
 * Validates submitted attribute values against a category's definitions.
 *
 * `submitted` keys that no definition covers are REJECTED rather than ignored:
 * silently dropping a field the seller filled in is worse than telling them it
 * does not belong here.
 */
export function validateAttributes(
  definitions: readonly AttributeDefinition[],
  submitted: Record<string, unknown>,
): AttributeValidationResult {
  const issues: AttributeIssue[] = [];
  const rows: AttributeValueRow[] = [];
  const json: Record<string, unknown> = {};

  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  for (const key of Object.keys(submitted)) {
    if (!byKey.has(key)) {
      issues.push({
        key,
        code: 'unknown_attribute',
        message: `"${key}" is not an attribute of this category`,
      });
    }
  }

  for (const definition of definitions) {
    const raw = submitted[definition.key];
    const absent = raw === undefined || raw === null || raw === '';

    if (absent) {
      if (definition.isRequired) {
        issues.push({ key: definition.key, code: 'required', message: 'This field is required' });
      }
      continue;
    }

    const row = emptyRow(definition);

    switch (definition.dataType) {
      case 'TEXT': {
        if (typeof raw !== 'string') {
          issues.push({ key: definition.key, code: 'wrong_type', message: 'Expected text' });
          continue;
        }
        const maxLength = definition.validation.maxLength ?? MAX_TEXT_LENGTH;
        if (raw.length > maxLength) {
          issues.push({
            key: definition.key,
            code: 'too_long',
            message: `At most ${maxLength} characters`,
          });
          continue;
        }
        if (
          definition.validation.minLength !== undefined &&
          raw.length < definition.validation.minLength
        ) {
          issues.push({
            key: definition.key,
            code: 'too_short',
            message: `At least ${definition.validation.minLength} characters`,
          });
          continue;
        }
        if (definition.validation.pattern && !matchesPattern(definition.validation.pattern, raw)) {
          issues.push({
            key: definition.key,
            code: 'pattern_mismatch',
            message: 'Value is not in the expected format',
          });
          continue;
        }
        rows.push({ ...row, valueText: raw });
        json[definition.key] = raw;
        break;
      }

      case 'NUMBER':
      case 'INTEGER': {
        // Accept a numeric string from a form field, but never coerce a
        // non-numeric one into NaN and store it.
        const numeric =
          typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
        if (!Number.isFinite(numeric)) {
          issues.push({ key: definition.key, code: 'wrong_type', message: 'Expected a number' });
          continue;
        }
        if (definition.dataType === 'INTEGER' && !Number.isInteger(numeric)) {
          issues.push({
            key: definition.key,
            code: 'wrong_type',
            message: 'Expected a whole number',
          });
          continue;
        }
        const { min, max } = definition.validation;
        if ((min !== undefined && numeric < min) || (max !== undefined && numeric > max)) {
          issues.push({
            key: definition.key,
            code: 'out_of_range',
            message: `Must be between ${min ?? '-∞'} and ${max ?? '∞'}`,
          });
          continue;
        }
        if (definition.dataType === 'INTEGER') {
          rows.push({ ...row, valueInteger: BigInt(numeric) });
        } else {
          // Stored as a string so DECIMAL precision survives the round trip.
          rows.push({ ...row, valueNumber: String(numeric) });
        }
        json[definition.key] = numeric;
        break;
      }

      case 'BOOLEAN': {
        const value =
          typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : null;
        if (value === null) {
          issues.push({
            key: definition.key,
            code: 'wrong_type',
            message: 'Expected true or false',
          });
          continue;
        }
        rows.push({ ...row, valueBoolean: value });
        json[definition.key] = value;
        break;
      }

      case 'ENUM': {
        if (typeof raw !== 'string') {
          issues.push({
            key: definition.key,
            code: 'wrong_type',
            message: 'Expected a single choice',
          });
          continue;
        }
        const option = definition.options.find((candidate) => candidate.value === raw);
        if (!option) {
          issues.push({
            key: definition.key,
            code: 'not_an_option',
            message: 'Not one of the available choices',
          });
          continue;
        }
        rows.push({ ...row, optionId: option.id });
        json[definition.key] = option.value;
        break;
      }

      case 'MULTI_ENUM': {
        if (!Array.isArray(raw)) {
          issues.push({
            key: definition.key,
            code: 'wrong_type',
            message: 'Expected a list of choices',
          });
          continue;
        }
        if (raw.length === 0) {
          if (definition.isRequired) {
            issues.push({
              key: definition.key,
              code: 'empty_selection',
              message: 'Choose at least one',
            });
          }
          continue;
        }
        const selected: string[] = [];
        let invalid = false;
        for (const entry of raw) {
          const option = definition.options.find((candidate) => candidate.value === entry);
          if (!option) {
            issues.push({
              key: definition.key,
              code: 'not_an_option',
              message: `"${String(entry)}" is not an available choice`,
            });
            invalid = true;
            break;
          }
          // One row per selected option; the unique index is
          // (listing, definition, option), so multiple rows coexist.
          rows.push({ ...row, optionId: option.id });
          selected.push(option.value);
        }
        if (!invalid) json[definition.key] = selected;
        break;
      }

      case 'DATE': {
        if (typeof raw !== 'string') {
          issues.push({ key: definition.key, code: 'wrong_type', message: 'Expected a date' });
          continue;
        }
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          issues.push({ key: definition.key, code: 'not_a_date', message: 'Not a valid date' });
          continue;
        }
        rows.push({ ...row, valueDate: parsed });
        json[definition.key] = parsed.toISOString();
        break;
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, rows, json };
}
