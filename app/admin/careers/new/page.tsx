import { PageHeader } from '../../components/PageHeader';
import { createJobOpening } from '../actions';
import { JobForm } from '../JobForm';

export default function NewJobOpeningPage() {
  return (
    <>
      <PageHeader
        title="New job opening"
        description="Saved to the job_openings table. New openings default to draft and are not publicly visible until opened."
      />
      <JobForm action={createJobOpening} submitLabel="Create opening" />
    </>
  );
}
