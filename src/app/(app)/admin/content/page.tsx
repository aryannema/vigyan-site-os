import Link from 'next/link';
import { CONTENT_SCHEMAS } from '@/lib/content-schema';


export const dynamic = 'force-dynamic';
const PAGE_LABELS: Record<string, string> = {
  global: 'Global',
  home: 'Home Page (/)',
  about: 'About Page (/about)',
  services: 'Services Page (/services)',
  contact: 'Contact Page (/contact)',
  blog: 'Blog Page (/blog)',
  template: 'Templates Page (/templates)',
  cta: 'Global CTA',
};

function groupSections() {
  const groups: Record<string, { id: string; description: string }[]> = {};
  for (const [id, def] of Object.entries(CONTENT_SCHEMAS)) {
    const prefix = id.split('-')[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push({ id, description: def.description });
  }
  return groups;
}

export default function ContentManagementPage() {
  const groups = groupSections();

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-ink dark:text-white">Site Content</h1>
        <p className="text-sm text-muted dark:text-faint mt-1">
          {Object.values(CONTENT_SCHEMAS).length} sections across {Object.keys(groups).length} pages
        </p>
      </div>

      {Object.entries(groups).map(([prefix, sections]) => (
        <div key={prefix} className="space-y-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-faint dark:text-muted px-1">
            {PAGE_LABELS[prefix] ?? prefix}
          </h2>
          <div className="rounded-2xl bg-surface dark:bg-surface border border-hairline dark:border-hairline overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {sections.map(({ id, description }) => (
                  <tr key={id} className="hover:bg-sand dark:hover:bg-surface transition group">
                    <td className="px-6 py-3.5">
                      <span className="font-mono text-[11px] text-saffron-ink">{id}</span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted hidden md:table-cell">
                      {description}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <Link
                        href={`/admin/content/${id}`}
                        className="text-xs font-bold text-saffron-ink hover:underline opacity-0 group-hover:opacity-100 transition"
                      >
                        Edit →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
