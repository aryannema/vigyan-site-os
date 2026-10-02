import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONTENT_SCHEMAS } from '@/lib/content-schema';
import { supabaseAdmin } from '@/lib/supabase';
import SectionEditor from './SectionEditor';


export const dynamic = 'force-dynamic';
async function getSectionData(sectionId: string) {
  const { data } = await supabaseAdmin
    .from('site_content')
    .select('content_data')
    .eq('section_id', sectionId)
    .single();
  return data?.content_data ?? null;
}

async function getSectionHistory(sectionId: string) {
  const { data } = await supabaseAdmin
    .from('content_history')
    .select('id, content_data, changed_by, created_at')
    .eq('section_id', sectionId)
    .order('created_at', { ascending: false })
    .limit(10);
  return data ?? [];
}

export default async function SectionEditorPage({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  const schemaDef = CONTENT_SCHEMAS[sectionId];
  if (!schemaDef) notFound();

  const [currentContent, history] = await Promise.all([
    getSectionData(sectionId),
    getSectionHistory(sectionId),
  ]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="border-b border-hairline dark:border-hairline pb-6">
        <Link href="/admin/content" className="text-xs text-muted hover:text-saffron-ink transition mb-2 inline-block">
          ← Site Content
        </Link>
        <h1 className="text-2xl font-bold text-ink dark:text-white font-mono">{sectionId}</h1>
        <p className="text-sm text-muted dark:text-faint mt-1">{schemaDef.description}</p>
      </div>

      <SectionEditor
        sectionId={sectionId}
        currentContent={currentContent}
        schema={schemaDef.schema}
        history={history}
      />
    </div>
  );
}
