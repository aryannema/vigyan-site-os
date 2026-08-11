'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '../../../lib/utils';

interface NavItem {
  label: string;
  href: string;
  /** Match only on an exact pathname (used for index routes). */
  exact?: boolean;
}

interface NavSection {
  /** Maps to a `resource_key` from the capability system where one applies. */
  section: string;
  items: NavItem[];
}

/**
 * Section names mirror RESOURCE_KEYS from the shared type contract, so the nav
 * and the permission model use one vocabulary. Deliberately generic — this is a
 * template; deployments rename these, they are not a brand.
 */
const NAV: NavSection[] = [
  {
    section: 'Overview',
    items: [{ label: 'Dashboard', href: '/admin', exact: true }],
  },
  {
    section: 'CMS',
    items: [{ label: 'Site Content', href: '/admin/cms' }],
  },
  {
    section: 'Blog',
    items: [
      { label: 'Posts', href: '/admin/blog', exact: true },
      { label: 'New Post', href: '/admin/blog/new' },
    ],
  },
  {
    section: 'Careers',
    items: [
      { label: 'Job Openings', href: '/admin/careers', exact: true },
      { label: 'New Opening', href: '/admin/careers/new' },
    ],
  },
  {
    section: 'CRM',
    items: [{ label: 'Contact Inquiries', href: '/admin/crm' }],
  },
  {
    section: 'Users',
    items: [
      { label: 'Users & Roles', href: '/admin/users', exact: true },
      { label: 'Capabilities', href: '/admin/users/capabilities' },
    ],
  },
  {
    section: 'Settings',
    items: [{ label: 'AI Settings', href: '/admin/ai-settings' }],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-4">
      {NAV.map((group) => (
        <div key={group.section}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {group.section}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
