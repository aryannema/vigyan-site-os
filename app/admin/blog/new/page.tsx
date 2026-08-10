import { PageHeader } from '../../components/PageHeader';
import { createPost } from '../actions';
import { PostForm } from '../PostForm';

export default function NewPostPage() {
  return (
    <>
      <PageHeader
        title="New post"
        description="Saved to the posts table. New posts default to draft — publishing is a separate, capability-gated action."
      />
      <PostForm action={createPost} submitLabel="Create post" />
    </>
  );
}
