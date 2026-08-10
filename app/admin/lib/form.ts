/**
 * Small form-parsing helpers shared by the admin CRUD forms.
 *
 * Deliberately hand-rolled rather than schema-library-driven: every field here
 * is also constrained in Postgres (NOT NULL, CHECK, UNIQUE), so this layer only
 * has to turn `FormData`'s string-or-File values into typed values and produce a
 * readable message before the database produces a less readable one.
 */

export interface FormState {
  error?: string;
  /** Field name -> message, for inline display. */
  fieldErrors?: Record<string, string>;
  /** Confirmation shown after an in-place save that does not navigate away. */
  success?: string;
}

export class FieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'FieldError';
  }
}

export function toFormState(error: unknown, fallback: string): FormState {
  if (error instanceof FieldError) {
    return { error: error.message, fieldErrors: { [error.field]: error.message } };
  }
  return { error: fallback };
}

function raw(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A required, non-empty string. */
export function requiredString(formData: FormData, name: string, label: string): string {
  const value = raw(formData, name);
  if (!value) throw new FieldError(name, `${label} is required.`);
  return value;
}

/** An optional string; empty input becomes NULL rather than an empty string. */
export function optionalString(formData: FormData, name: string): string | null {
  return raw(formData, name) || null;
}

/** An optional number; rejects non-numeric input rather than silently nulling it. */
export function optionalNumber(formData: FormData, name: string, label: string): number | null {
  const value = raw(formData, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new FieldError(name, `${label} must be a number.`);
  return parsed;
}

/** An optional `YYYY-MM-DD` date, as accepted by <input type="date">. */
export function optionalDate(formData: FormData, name: string, label: string): string | null {
  const value = raw(formData, name);
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FieldError(name, `${label} must be a date (YYYY-MM-DD).`);
  }
  return value;
}

/** A value constrained to one of the vocabularies exported by types/schema.ts. */
export function oneOf<T extends string>(
  formData: FormData,
  name: string,
  label: string,
  allowed: readonly T[],
  options?: { optional?: boolean },
): T | null {
  const value = raw(formData, name);
  if (!value) {
    if (options?.optional) return null;
    throw new FieldError(name, `${label} is required.`);
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw new FieldError(name, `${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A URL slug. Validated here as well as being UNIQUE in the database, because a
 * slug with a space in it fails as a 404 much later rather than as a constraint.
 */
export function slug(formData: FormData, name: string, label: string): string {
  const value = requiredString(formData, name, label);
  if (!SLUG_PATTERN.test(value)) {
    throw new FieldError(
      name,
      `${label} may contain only lowercase letters, numbers and single hyphens.`,
    );
  }
  return value;
}

/** Textarea with one entry per line -> text[]; blank input becomes NULL. */
export function optionalLines(formData: FormData, name: string): string[] | null {
  const value = raw(formData, name);
  if (!value) return null;
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}

/**
 * Formats a value for `<input type="date">`, which accepts only `YYYY-MM-DD`.
 *
 * Needed because node-postgres decodes a `date` column into a JS `Date` (in the
 * server's local timezone), not the `YYYY-MM-DD` string the type contract
 * describes. `String(date).slice(0, 10)` yields `"Fri Jan 31"`, which the input
 * silently rejects — the field renders blank and the next save wipes the column.
 *
 * The date parts are read in LOCAL time on purpose: node-postgres built the Date
 * by interpreting the calendar date locally, so `toISOString()` would shift it a
 * day backwards for any timezone east of UTC.
 */
export function toDateInputValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return '';
}

/** Client-side-friendly slugifier, also used to suggest a slug from a title. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
