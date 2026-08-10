'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  EMPLOYMENT_TYPES,
  JOB_OPENING_STATUSES,
  SALARY_PERIODS,
  WORKPLACE_TYPES,
  type EmploymentType,
  type JobOpening,
  type JobOpeningStatus,
  type SalaryPeriod,
  type WorkplaceType,
} from '@/types/schema';

import { mutate, toFormError } from '../lib/db';
import {
  oneOf,
  optionalDate,
  optionalLines,
  optionalNumber,
  optionalString,
  requiredString,
  slug as slugField,
  toFormState,
  type FormState,
} from '../lib/form';

/** See `../lib/db.ts` for why these are direct statements rather than perform_action(). */

interface JobFields {
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  employment_type: EmploymentType;
  workplace_type: WorkplaceType | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  description: string;
  responsibilities: string[] | null;
  requirements: string[] | null;
  apply_url: string | null;
  apply_email: string | null;
  status: JobOpeningStatus;
  valid_through: string | null;
}

function readJobFields(formData: FormData): JobFields {
  return {
    title: requiredString(formData, 'title', 'Title'),
    slug: slugField(formData, 'slug', 'Slug'),
    department: optionalString(formData, 'department'),
    location: optionalString(formData, 'location'),
    employment_type: oneOf(
      formData,
      'employment_type',
      'Employment type',
      EMPLOYMENT_TYPES,
    ) as EmploymentType,
    workplace_type: oneOf(formData, 'workplace_type', 'Workplace type', WORKPLACE_TYPES, {
      optional: true,
    }),
    salary_min: optionalNumber(formData, 'salary_min', 'Minimum salary'),
    salary_max: optionalNumber(formData, 'salary_max', 'Maximum salary'),
    salary_currency: optionalString(formData, 'salary_currency'),
    salary_period: oneOf(formData, 'salary_period', 'Salary period', SALARY_PERIODS, {
      optional: true,
    }),
    description: requiredString(formData, 'description', 'Description'),
    responsibilities: optionalLines(formData, 'responsibilities'),
    requirements: optionalLines(formData, 'requirements'),
    apply_url: optionalString(formData, 'apply_url'),
    apply_email: optionalString(formData, 'apply_email'),
    status: oneOf(formData, 'status', 'Status', JOB_OPENING_STATUSES) as JobOpeningStatus,
    valid_through: optionalDate(formData, 'valid_through', 'Valid through'),
  };
}

function values(fields: JobFields): unknown[] {
  return [
    fields.title,
    fields.slug,
    fields.department,
    fields.location,
    fields.employment_type,
    fields.workplace_type,
    fields.salary_min,
    fields.salary_max,
    fields.salary_currency,
    fields.salary_period,
    fields.description,
    fields.responsibilities,
    fields.requirements,
    fields.apply_url,
    fields.apply_email,
    fields.status,
    fields.valid_through,
  ];
}

export async function createJobOpening(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const fields = readJobFields(formData);
    id = await mutate(async (client) => {
      const inserted = await client.query<JobOpening>(
        `INSERT INTO public.job_openings
           (title, slug, department, location, employment_type, workplace_type,
            salary_min, salary_max, salary_currency, salary_period, description,
            responsibilities, requirements, apply_url, apply_email, status,
            valid_through, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 CASE WHEN $16 = 'open' THEN now() ELSE NULL END)
         RETURNING *`,
        values(fields),
      );
      const row = inserted.rows[0]!;
      return {
        result: row.id,
        audit: {
          resourceKey: 'careers',
          action: 'create' as const,
          targetId: row.id,
          after: row,
        },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  revalidatePath('/admin/careers');
  redirect(`/admin/careers/${id}`);
}

export async function updateJobOpening(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const fields = readJobFields(formData);
    await mutate(async (client) => {
      const before = await client.query<JobOpening>(
        `SELECT * FROM public.job_openings WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (before.rows.length === 0) throw new Error('That job opening no longer exists.');

      const updated = await client.query<JobOpening>(
        `UPDATE public.job_openings
            SET title            = $2,
                slug             = $3,
                department       = $4,
                location         = $5,
                employment_type  = $6,
                workplace_type   = $7,
                salary_min       = $8,
                salary_max       = $9,
                salary_currency  = $10,
                salary_period    = $11,
                description      = $12,
                responsibilities = $13,
                requirements     = $14,
                apply_url        = $15,
                apply_email      = $16,
                status           = $17,
                valid_through    = $18,
                -- Stamped the first time the role goes live, then left alone so a
                -- close/reopen cycle does not rewrite the original posting date.
                posted_at        = CASE WHEN $17 = 'open' AND posted_at IS NULL
                                        THEN now() ELSE posted_at END,
                updated_at       = now()
          WHERE id = $1
          RETURNING *`,
        [id, ...values(fields)],
      );

      const wasOpen = before.rows[0]!.status === 'open';
      const nowOpen = fields.status === 'open';

      return {
        result: undefined,
        audit: {
          resourceKey: 'careers',
          action: (wasOpen !== nowOpen ? 'publish' : 'edit') as 'publish' | 'edit',
          targetId: id,
          before: before.rows[0],
          after: updated.rows[0],
        },
      };
    });
  } catch (error) {
    return toFormState(error, toFormError(error));
  }

  revalidatePath('/admin/careers');
  revalidatePath(`/admin/careers/${id}`);
  return { success: 'Saved.' };
}

export async function setJobStatus(id: string, status: string): Promise<void> {
  if (!(JOB_OPENING_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  await mutate(async (client) => {
    const before = await client.query<JobOpening>(
      `SELECT * FROM public.job_openings WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rows.length === 0) throw new Error('That job opening no longer exists.');

    const updated = await client.query<JobOpening>(
      `UPDATE public.job_openings
          SET status     = $2,
              posted_at  = CASE WHEN $2 = 'open' AND posted_at IS NULL THEN now() ELSE posted_at END,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, status],
    );

    return {
      result: undefined,
      audit: {
        resourceKey: 'careers',
        action: 'publish' as const,
        targetId: id,
        before: { status: before.rows[0]!.status },
        after: { status: updated.rows[0]!.status },
      },
    };
  });

  revalidatePath('/admin/careers');
  revalidatePath(`/admin/careers/${id}`);
}

export async function deleteJobOpening(id: string): Promise<void> {
  await mutate(async (client) => {
    const deleted = await client.query<JobOpening>(
      `DELETE FROM public.job_openings WHERE id = $1 RETURNING *`,
      [id],
    );
    if (deleted.rows.length === 0) throw new Error('That job opening no longer exists.');
    return {
      result: undefined,
      audit: {
        resourceKey: 'careers',
        action: 'delete' as const,
        targetId: id,
        before: deleted.rows[0],
      },
    };
  });

  revalidatePath('/admin/careers');
  redirect('/admin/careers');
}

export async function setJobStatusAction(formData: FormData): Promise<void> {
  await setJobStatus(String(formData.get('id')), String(formData.get('status')));
}

export async function deleteJobOpeningAction(formData: FormData): Promise<void> {
  await deleteJobOpening(String(formData.get('id')));
}
