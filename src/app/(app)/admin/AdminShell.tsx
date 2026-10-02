'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  FileText,
  FilePlus2,
  LayoutTemplate,
  Image as ImageIcon,
  MessageSquare,
  Briefcase,
  PlusCircle,
  Package,
  CreditCard,
  Settings2,
  Inbox,
  MessageCircle,
  UserCircle,
  UserX,
  BarChart3,
  Search,
  Gauge,
  Link2,
  Users,
  ShieldCheck,
  Sparkles,
  Settings,
  PanelTop,
  Menu,
  type LucideIcon,
  KeyRound,
  Lock,
  Building2,
  PackagePlus,
  BookOpen,
  Calculator,
  ChevronRight,
  Newspaper,
  Wallet,
  Contact,
  LineChart,
  Shield,
  Cog,
} from 'lucide-react';
import LogoutButton from './LogoutButton';
import BrandMark from '@/components/brand/BrandMark';

interface AdminShellProps {
  email: string;
  initials: string;
  children: React.ReactNode;
}

type NavLink = { label: string; href: string; icon: LucideIcon; accent?: boolean };
type NavEntry = NavLink | { section: string; icon: LucideIcon; items: NavLink[] };

const NAV: NavEntry[] = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  {
    section: 'CMS',
    icon: Newspaper,
    items: [
      { label: 'All Posts', href: '/admin/blog', icon: FileText },
      { label: 'New Draft', href: '/admin/blog/new', icon: FilePlus2, accent: true },
      { label: 'Landing Pages', href: '/admin/landing-pages', icon: PanelTop },
      { label: 'Header Menu', href: '/admin/nav', icon: Menu },
      { label: 'Site Content', href: '/admin/content', icon: LayoutTemplate },
      { label: 'Media Library', href: '/admin/media', icon: ImageIcon },
      { label: 'Comments', href: '/admin/blog/comments', icon: MessageSquare },
    ],
  },
  {
    section: 'Recruiting',
    icon: Briefcase,
    items: [
      { label: 'Careers', href: '/admin/careers', icon: Briefcase },
      { label: 'New Opening', href: '/admin/careers/new', icon: PlusCircle, accent: true },
    ],
  },
  {
    section: 'Revenue',
    icon: Wallet,
    items: [
      { label: 'Products', href: '/admin/products', icon: Package },
      { label: 'New Product', href: '/admin/products/new', icon: PackagePlus, accent: true },
      { label: 'Pricing Calculator', href: '/admin/pricing', icon: Calculator },
      { label: 'Payments', href: '/admin/payments', icon: CreditCard },
      { label: 'Gateway Config', href: '/admin/payments/config', icon: Settings2 },
    ],
  },
  {
    section: 'CRM',
    icon: Contact,
    items: [
      { label: 'All Inquiries', href: '/admin/crm', icon: Inbox },
      { label: 'WhatsApp', href: '/admin/whatsapp', icon: MessageCircle },
      { label: 'Knowledge Base', href: '/admin/kb', icon: BookOpen },
      { label: 'Accounts', href: '/admin/accounts', icon: UserCircle },
      { label: 'Account Deletions', href: '/admin/account-deletions', icon: UserX },
    ],
  },
  {
    section: 'Insights',
    icon: LineChart,
    items: [
      { label: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
      { label: 'Search Console', href: '/admin/analytics/seo', icon: Search },
      { label: 'SEO Score', href: '/admin/seo-score', icon: Gauge },
      { label: 'Link Builder', href: '/admin/links', icon: Link2 },
    ],
  },
  {
    section: 'Access',
    icon: Shield,
    items: [
      { label: 'Users & Roles', href: '/admin/users', icon: Users },
      { label: 'Capabilities', href: '/admin/users/capabilities', icon: ShieldCheck },
    ],
  },
  {
    section: 'System',
    icon: Cog,
    items: [
      { label: 'AI Settings', href: '/admin/ai-settings', icon: Sparkles },
      { label: 'Settings', href: '/admin/settings', icon: Settings },
      { label: 'Secrets', href: '/admin/settings/secrets', icon: Lock },
      { label: 'Encryption Keys', href: '/admin/settings/keys', icon: KeyRound },
      { label: 'Company Info', href: '/admin/settings/company-info', icon: Building2 },
    ],
  },
];

// Every leaf href, used by isNavActive() below to resolve which single entry
// should light up for a given pathname -- exact match always wins, and among
// prefix matches (e.g. /admin/blog/123/edit under /admin/blog) the LONGEST
// href wins, so a sibling route (/admin/blog/new) never steals another
// route's highlight and Overview (/admin) never lights up for everything.
const ALL_HREFS = NAV.flatMap((entry) => ('href' in entry ? [entry.href] : entry.items.map((item) => item.href)));

function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/admin') return false; // Overview: exact match only, never a prefix
  if (!pathname.startsWith(`${href}/`)) return false;
  return !ALL_HREFS.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;
  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline-strong bg-surface text-muted transition hover:text-saffron-ink"
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

const GROUPS_STORAGE_KEY = 'vb-admin-nav-groups';

function linkClass(active: boolean, accent: boolean | undefined, collapsed: boolean | undefined) {
  return `flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition ${collapsed ? 'justify-center py-2' : ''} ${
    active
      ? 'bg-saffron-500/10 text-saffron-ink'
      : accent
      ? 'text-saffron-ink hover:bg-saffron-500/10'
      : 'text-muted hover:bg-sand hover:text-ink'
  }`;
}

function NavItems({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) ?? '{}');
      if (stored && typeof stored === 'object') setOpen(stored);
    } catch {
      /* ignore unreadable preference */
    }
  }, []);

  function toggle(section: string, isOpen: boolean) {
    setOpen((prev) => {
      const next = { ...prev, [section]: !isOpen };
      try {
        window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  return (
    <>
      {NAV.map((entry, i) => {
        if ('href' in entry) {
          const active = isNavActive(pathname, entry.href);
          const Icon = entry.icon;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? entry.label : undefined}
              className={linkClass(active, false, collapsed)}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && entry.label}
            </Link>
          );
        }

        const hasActive = entry.items.some((item) => isNavActive(pathname, item.href));

        if (collapsed) {
          return (
            <div key={`section-${i}`}>
              {i > 0 && <div className="my-2 border-t border-hairline-faint" />}
              {entry.items.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={`${entry.section} · ${item.label}`}
                    className={linkClass(active, item.accent, true)}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          );
        }

        // A group holding the current page is always open, so the highlighted
        // item is never hidden inside a closed group.
        const isOpen = hasActive || Boolean(open[entry.section]);
        const GroupIcon = entry.icon;
        const panelId = `nav-group-${i}`;
        return (
          <div key={`section-${i}`}>
            <button
              type="button"
              onClick={() => toggle(entry.section, isOpen)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition hover:bg-sand ${
                hasActive ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <GroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left">{entry.section}</span>
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
            </button>
            {isOpen && (
              <div id={panelId} className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-hairline pl-2">
                {entry.items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={linkClass(active, item.accent, false)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function SidebarContent({
  email,
  initials,
  onNavigate,
  collapsed,
  onToggleCollapse,
}: {
  email: string;
  initials: string;
  onNavigate?: () => void;
  /** Icon-rail mode (desktop only) -- omit entirely on the mobile drawer, which is
   * never collapsed (it's an overlay, not permanent chrome, so there's no width to save). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-r border-hairline bg-surface">
      <div className={`border-b border-hairline ${collapsed ? 'p-3' : 'p-6'}`}>
        <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
          <Link href="/admin" className="inline-flex items-center gap-2 transition hover:opacity-80" title={collapsed ? 'YourSite Admin Hub' : undefined}>
            <BrandMark size={28} on="ivory" className="dark:hidden" />
            <BrandMark size={28} on="deep" className="hidden dark:block" />
            {!collapsed && <span className="text-sm font-bold text-ink">YourSite</span>}
          </Link>
        </div>
        {!collapsed && (
          <p className="mt-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-green-ink">Admin Hub</p>
        )}
      </div>
      <nav className={`flex-1 space-y-0.5 overflow-y-auto ${collapsed ? 'p-2' : 'p-4'}`}>
        <NavItems onNavigate={onNavigate} collapsed={collapsed} />
      </nav>
      <div className={`border-t border-hairline ${collapsed ? 'p-2' : 'p-4'}`}>
        <div className={`flex items-center gap-3 px-3 py-2 ${collapsed ? 'justify-center px-0' : ''}`} title={collapsed ? email || 'Administrator' : undefined}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-saffron-500/18 text-xs font-bold text-saffron-ink">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium text-ink">{email || 'Administrator'}</span>
              <span className="text-[10px] text-faint">Admin</span>
            </div>
          )}
        </div>
        <LogoutButton collapsed={collapsed} />
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`mt-2 flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-sand hover:text-ink ${collapsed ? 'mx-auto' : 'ml-3'}`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

const DESKTOP_SIDEBAR_STORAGE_KEY = 'vb-admin-sidebar-open';

export default function AdminShell({ email, initials, children }: AdminShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Defaults open so SSR/first paint always shows the sidebar; a stored
  // "closed" preference is applied right after mount, matching the
  // ThemeToggle's own mounted-guard pattern above to avoid a hydration
  // mismatch (server never knows the visitor's localStorage value).
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY);
    if (stored === 'closed') setDesktopSidebarOpen(false);
  }, []);

  function toggleDesktopSidebar() {
    setDesktopSidebarOpen((open) => {
      const next = !open;
      window.localStorage.setItem(DESKTOP_SIDEBAR_STORAGE_KEY, next ? 'open' : 'closed');
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-paper font-sans text-ink">
      {/* Desktop sidebar -- always rendered; collapse shrinks it to an icon
          rail rather than removing it, so the toggle (living in the
          sidebar's own header, not the main-content topbar) stays reachable
          in both states, matching the standard convention (VS Code/Notion/
          Linear) instead of the previous fully-vanishing behavior. */}
      <aside className={`hidden shrink-0 transition-[width] duration-200 md:sticky md:top-0 md:flex md:h-screen md:flex-col ${desktopSidebarOpen ? 'md:w-64' : 'md:w-[68px]'}`}>
        <SidebarContent
          email={email}
          initials={initials}
          collapsed={!desktopSidebarOpen}
          onToggleCollapse={toggleDesktopSidebar}
        />
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col transition-transform duration-300 ease-out md:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative h-full">
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-sand text-muted"
            aria-label="Close sidebar"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <SidebarContent email={email} initials={initials} onNavigate={() => setSidebarOpen(false)} />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="vb-nav sticky top-0 z-30 flex h-14 items-center justify-between border-b border-hairline px-4 md:h-16 md:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-sand md:hidden"
              aria-label="Open sidebar"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="hidden text-sm font-semibold text-muted md:block">Dashboard</span>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <ThemeToggle />
            <Link
              href="/"
              className="rounded-md border border-hairline-strong bg-surface px-3 py-2 text-xs font-bold text-body transition hover:border-saffron-500/50 md:px-4"
            >
              View Site
            </Link>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
