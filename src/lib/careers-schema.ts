// Careers / Job Openings — modeled on schema.org JobPosting (also drives the
// JobPosting JSON-LD on each public role page for Google Jobs).

export const JOB_EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'TEMPORARY'] as const;
export type JobEmploymentType = (typeof JOB_EMPLOYMENT_TYPES)[number];

export const WORKPLACE_TYPES = ['on-site', 'remote', 'hybrid'] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const JOB_STATUSES = ['draft', 'open', 'closed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SALARY_PERIODS = ['YEAR', 'MONTH', 'HOUR'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Human label for an employment type (e.g. INTERN → "Internship"). */
export const EMPLOYMENT_TYPE_LABEL: Record<JobEmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'Contract',
  INTERN: 'Internship',
  TEMPORARY: 'Temporary',
};

export interface JobOpening {
  id: string;
  title: string;
  slug: string;
  department?: string | null;
  location?: string | null;
  employment_type: JobEmploymentType;
  workplace_type?: WorkplaceType | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: SalaryPeriod | null;
  description: string;
  responsibilities?: string[] | null;
  requirements?: string[] | null;
  apply_url?: string | null;
  apply_email?: string | null;
  status: JobStatus;
  valid_through?: string | null;
  posted_at?: string | null;
  created_at: string;
}

export const JOB_SCHEMA = {
  type: 'object',
  required: ['title', 'slug', 'employment_type', 'description'],
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 200 },
    slug: {
      type: 'string',
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      description: 'URL-safe slug (lowercase, hyphens only)',
    },
    department: { type: 'string', maxLength: 80, nullable: true },
    location: { type: 'string', maxLength: 120, nullable: true },
    employment_type: { type: 'string', enum: JOB_EMPLOYMENT_TYPES },
    workplace_type: { type: 'string', enum: WORKPLACE_TYPES, nullable: true },
    salary_min: { type: 'number', minimum: 0, nullable: true },
    salary_max: { type: 'number', minimum: 0, nullable: true },
    salary_currency: { type: 'string', maxLength: 8, default: 'INR', nullable: true },
    salary_period: { type: 'string', enum: SALARY_PERIODS, default: 'YEAR', nullable: true },
    description: { type: 'string', minLength: 20 },
    responsibilities: { type: 'array', items: { type: 'string', maxLength: 300 }, nullable: true },
    requirements: { type: 'array', items: { type: 'string', maxLength: 300 }, nullable: true },
    apply_url: { type: 'string', format: 'uri', nullable: true },
    apply_email: { type: 'string', format: 'email', nullable: true },
    status: { type: 'string', enum: JOB_STATUSES, default: 'open' },
    valid_through: { type: 'string', format: 'date', nullable: true },
    posted_at: { type: 'string', format: 'date-time', nullable: true },
  },
  additionalProperties: false,
};
