'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  EMPLOYMENT_TYPES,
  JOB_OPENING_STATUSES,
  SALARY_PERIODS,
  WORKPLACE_TYPES,
  type JobOpening,
} from '@/types/schema';

import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { SubmitButton } from '../components/SubmitButton';
import { slugify, toDateInputValue, type FormState } from '../lib/form';

interface JobFormProps {
  job?: JobOpening;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const lines = (value: string[] | null | undefined) => (value ?? []).join('\n');

export function JobForm({ job, action, submitLabel }: JobFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const [title, setTitle] = useState(job?.title ?? '');
  const [slug, setSlug] = useState(job?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(job?.slug));

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-5">
      {state.error && !Object.keys(errors).length ? (
        <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
          {state.success}
        </p>
      ) : null}

      <Field label="Title" htmlFor="title" error={errors.title}>
        <Input
          id="title"
          name="title"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            if (!slugTouched) setSlug(slugify(event.currentTarget.value));
          }}
        />
      </Field>

      <Field
        label="Slug"
        htmlFor="slug"
        hint="Lowercase letters, numbers and single hyphens. Must be unique."
        error={errors.slug}
      >
        <Input
          id="slug"
          name="slug"
          required
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.currentTarget.value);
          }}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Department" htmlFor="department" error={errors.department}>
          <Input id="department" name="department" defaultValue={job?.department ?? ''} />
        </Field>
        <Field label="Location" htmlFor="location" error={errors.location}>
          <Input id="location" name="location" defaultValue={job?.location ?? ''} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Employment type" htmlFor="employment_type" error={errors.employment_type}>
          <Select
            id="employment_type"
            name="employment_type"
            defaultValue={job?.employment_type ?? 'FULL_TIME'}
          >
            {EMPLOYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Workplace type" htmlFor="workplace_type" error={errors.workplace_type}>
          <Select id="workplace_type" name="workplace_type" defaultValue={job?.workplace_type ?? ''}>
            <option value="">Not specified</option>
            {WORKPLACE_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Status"
          htmlFor="status"
          hint="Only 'open' is publicly visible."
          error={errors.status}
        >
          <Select id="status" name="status" defaultValue={job?.status ?? 'draft'}>
            {JOB_OPENING_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="grid gap-5 sm:grid-cols-4">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Compensation</legend>
        <Field label="Minimum" htmlFor="salary_min" error={errors.salary_min}>
          <Input
            id="salary_min"
            name="salary_min"
            inputMode="decimal"
            defaultValue={job?.salary_min ?? ''}
          />
        </Field>
        <Field label="Maximum" htmlFor="salary_max" error={errors.salary_max}>
          <Input
            id="salary_max"
            name="salary_max"
            inputMode="decimal"
            defaultValue={job?.salary_max ?? ''}
          />
        </Field>
        <Field label="Currency" htmlFor="salary_currency" error={errors.salary_currency}>
          <Input
            id="salary_currency"
            name="salary_currency"
            defaultValue={job?.salary_currency ?? ''}
            placeholder="e.g. USD"
          />
        </Field>
        <Field label="Period" htmlFor="salary_period" error={errors.salary_period}>
          <Select id="salary_period" name="salary_period" defaultValue={job?.salary_period ?? ''}>
            <option value="">Not specified</option>
            {SALARY_PERIODS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <Field label="Description" htmlFor="description" error={errors.description}>
        <Textarea id="description" name="description" rows={8} required defaultValue={job?.description ?? ''} />
      </Field>

      <Field
        label="Responsibilities"
        htmlFor="responsibilities"
        hint="One per line. Stored as a text[] column."
        error={errors.responsibilities}
      >
        <Textarea
          id="responsibilities"
          name="responsibilities"
          rows={5}
          defaultValue={lines(job?.responsibilities)}
        />
      </Field>

      <Field
        label="Requirements"
        htmlFor="requirements"
        hint="One per line. Stored as a text[] column."
        error={errors.requirements}
      >
        <Textarea
          id="requirements"
          name="requirements"
          rows={5}
          defaultValue={lines(job?.requirements)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Apply URL" htmlFor="apply_url" error={errors.apply_url}>
          <Input id="apply_url" name="apply_url" defaultValue={job?.apply_url ?? ''} />
        </Field>
        <Field label="Apply email" htmlFor="apply_email" error={errors.apply_email}>
          <Input id="apply_email" name="apply_email" type="email" defaultValue={job?.apply_email ?? ''} />
        </Field>
        <Field label="Valid through" htmlFor="valid_through" error={errors.valid_through}>
          <Input
            id="valid_through"
            name="valid_through"
            type="date"
            defaultValue={toDateInputValue(job?.valid_through)}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/careers" className="text-sm text-muted-foreground underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
