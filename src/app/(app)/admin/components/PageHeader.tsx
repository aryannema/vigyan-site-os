import Link from 'next/link';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: { label: string; href: string; external?: boolean };
  /** Section trail above the title, e.g. [{ label: 'Insights' }, { label: 'Analytics' }]. Last item is the current page and never a link. */
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

/**
 * Ported from vigyan-site-os's `app/admin/components/PageHeader.tsx`, restyled
 * onto this repo's tokens so it matches the header treatment the pre-existing
 * admin pages (blog list, careers, whatsapp) already use.
 */
export function PageHeader({ title, description, action, breadcrumbs }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs text-faint">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.label} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="transition hover:text-muted">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className={i === breadcrumbs.length - 1 ? 'text-muted' : undefined}>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          target={action.external ? '_blank' : undefined}
          rel={action.external ? 'noopener noreferrer' : undefined}
          className="inline-flex h-9 items-center rounded-xl bg-saffron-500 px-5 text-sm font-bold text-[#1c1814] shadow-[0_6px_18px_rgba(245,158,11,0.22)] transition hover:brightness-[1.04]"
        >
          {action.label}
        </Link>
      ) : null}
    </header>
  );
}
