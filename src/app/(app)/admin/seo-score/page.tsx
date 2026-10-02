import { CheckCircle2, XCircle, ExternalLink } from 'lucide-react';

import { ScoreRing } from '@/components/ui/score-ring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { PageHeader } from '../components/PageHeader';
import { scoreSite, type PageSeoScore } from '@/lib/seo-score';

export const dynamic = 'force-dynamic';

function siteAverage(pages: PageSeoScore[]): number {
  const scored = pages.filter((p) => !p.fetchError);
  if (scored.length === 0) return 0;
  return Math.round(scored.reduce((sum, p) => sum + p.score, 0) / scored.length);
}

function PageScoreCard({ page }: { page: PageSeoScore }) {
  if (page.fetchError) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-6">
          <div>
            <p className="font-bold text-ink">{page.path}</p>
            <p className="mt-1 text-sm text-destructive">Couldn&apos;t fetch: {page.fetchError}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="flex items-center gap-4">
          <ScoreRing score={page.score} size={72} strokeWidth={6} />
          <div className="min-w-0 flex-1">
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-bold text-ink hover:text-saffron-ink"
            >
              {page.path}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </a>
            <p className="mt-0.5 truncate text-xs text-muted">{page.title ?? 'No title'}</p>
          </div>
        </div>

        <ul className="space-y-1.5">
          {page.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2 text-sm">
              {check.pass ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-ink" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <span className={check.pass ? 'text-body' : 'font-medium text-ink'}>{check.label}</span>
                <span className="ml-1.5 text-xs text-muted">{check.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function SeoScorePage() {
  const pages = await scoreSite();
  const average = siteAverage(pages);
  const needsWork = pages.filter((p) => !p.fetchError && p.score < 90);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="SEO Score"
        description="Per-page on-page SEO checklist, scored live against the site's rendered HTML"
        breadcrumbs={[{ label: 'Insights' }, { label: 'SEO Score' }]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Site average
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <ScoreRing score={average} size={110} strokeWidth={9} />
          <div>
            <p className="text-sm text-body">
              {needsWork.length === 0
                ? 'Every audited page scores 90+.'
                : `${needsWork.length} of ${pages.length} pages need work before they're in good shape.`}
            </p>
            <p className="mt-1 text-xs text-muted">
              Scored against: title tag, meta description, one H1, self-referencing canonical, Open Graph
              tags, at least one internal link pointing here, and content depth (150+ words).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pages.map((page) => (
          <PageScoreCard key={page.path} page={page} />
        ))}
      </div>
    </div>
  );
}
