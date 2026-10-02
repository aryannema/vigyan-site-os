"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import BrandLogo from "@/components/brand/BrandLogo";
import type { NavItem } from "@/lib/nav";

/**
 * SiteHeaderClient — the fixed live-site header. Adds `.scrolled` after a small
 * scroll, and mirrors the scroll-driven theme: it reads `document.body.dataset.mode`
 * (set by HomeExperience) to toggle `.on-dark` and swap the wordmark logo.
 */
export default function SiteHeaderClient({
  // Resolved on the server (lib/nav.ts, editable at /admin/nav) with feature
  // flags already applied, because this client component cannot read them.
  nav,
}: { nav: NavItem[] }) {
  const [dark, setDark] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [hasAdminAccess, setHasAdminAccess] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    // user_roles has a "self read" RLS policy (003 §8.10) — every signed-in
    // user may read their OWN role row, which is exactly what the header
    // needs to decide whether to show a Dashboard link. A row existing at
    // all (any role) means real access, not the pending-approval state.
    const syncFromSession = async (userId: string | undefined, meta: { full_name?: string; email?: string } | undefined) => {
      if (!userId) {
        setDisplayName("");
        setHasAdminAccess(false);
        return;
      }
      setDisplayName(meta?.full_name || meta?.email || "");
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      setHasAdminAccess(!!roleRow);
    };

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      setLoggedIn(!!session);
      syncFromSession(session?.user.id, {
        full_name: session?.user.user_metadata?.full_name,
        email: session?.user.email,
      });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session);
      syncFromSession(session?.user.id, {
        full_name: session?.user.user_metadata?.full_name,
        email: session?.user.email,
      });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await createBrowserSupabaseClient().auth.signOut();
    window.location.href = "/";
  };

  useEffect(() => {
    // `scrolled` MUST be React state, not hdr.classList.toggle(). React owns
    // this element's className, so any re-render (setDark below, or the async
    // Supabase session resolving) rewrites the attribute and silently destroys
    // an imperatively-added class. That was a live bug: scrolling into the dark
    // band fired setDark, which wiped `.scrolled`, leaving the header fully
    // transparent with page text legible straight through the nav -- and doing
    // it exactly where the nav turns dark-on-dark.
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const syncMode = () => setDark(document.body.dataset.mode === "dark");
    syncMode();
    const obs = new MutationObserver(syncMode);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-mode"] });

    return () => {
      window.removeEventListener("scroll", onScroll);
      obs.disconnect();
    };
  }, []);

  // Mobile nav opens as a fixed overlay independent of page scroll, so lock
  // background scroll while it's open (otherwise the page behind scrolls too).
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <header id="hdr" className={[dark && "on-dark", scrolled && "scrolled"].filter(Boolean).join(" ") || undefined}>
      <div className="wrap nav">
        <Link href="/" aria-label="YourSite home" className="flex items-center gap-2.5">
          {/* The supplied primary lockup, swapped by ground rather than
              recoloured: the homepage's scroll-driven theme shift sets
              body[data-mode], which `dark` tracks, so the -deep cut is used
              over the deep band and the -ivory cut everywhere else.
              Previously this retyped the wordmark in HTML with a retired hex
              amber for "Bytes". 28 px mobile / 36 px desktop per STEP 8;
              height is set in CSS with width auto so the ratio is preserved. */}
          <BrandLogo
            lockup="primary"
            on={dark ? "deep" : "ivory"}
            className="h-7 w-auto md:h-9"
            priority
          />
        </Link>
        <nav className="nav-links">
          {nav.map((l) =>
            l.children.length > 0 ? (
              <div key={l.id} className="nav-item has-sub">
                <Link href={l.href} aria-haspopup="true">
                  {l.label}
                  <svg className="nav-caret" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
                </Link>
                <div className="nav-sub">
                  {l.children.map((c) => (
                    <Link key={c.id} href={c.href}>{c.label}</Link>
                  ))}
                </div>
              </div>
            ) : (
              <Link key={l.id} href={l.href}>{l.label}</Link>
            ),
          )}
        </nav>
        <div className="nav-right">
          {/* Primary CTA (STEP 8). Hidden on small screens, where the mobile
              panel carries it instead, so the header does not crowd the logo. */}
          <Link className="nav-cta" href="/contact">
            Book a call
          </Link>
          {loggedIn ? (
            <>
              {displayName && <span className="util" style={{ pointerEvents: "none" }}>{displayName}</span>}
              {hasAdminAccess && (
                <Link className="util" href="/admin" aria-label="Admin dashboard">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                  <span>Dashboard</span>
                </Link>
              )}
              <button type="button" className="util" onClick={handleLogout} aria-label="Log out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
                <span>Logout</span>
              </button>
            </>
          ) : (
            <Link className="util" href="/account" aria-label="My account">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>
              <span>Account</span>
            </Link>
          )}
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            )}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav className="mobile-nav-panel" onClick={() => setMobileOpen(false)}>
          {nav.map((l) => (
            <div key={l.id} className="mobile-nav-group">
              <Link href={l.href}>{l.label}</Link>
              {l.children.map((c) => (
                <Link key={c.id} href={c.href} className="mobile-nav-child">{c.label}</Link>
              ))}
            </div>
          ))}
          {/* The header CTA is desktop-only, so it appears here instead. */}
          <Link href="/contact" className="font-bold text-saffron-ink">Book a call</Link>
          {loggedIn ? (
            <>
              {displayName && <span style={{ opacity: 0.7, fontSize: "0.9em" }}>{displayName}</span>}
              {hasAdminAccess && <Link href="/admin">Dashboard</Link>}
              <button type="button" onClick={handleLogout} style={{ textAlign: "left" }}>Logout</button>
            </>
          ) : (
            <Link href="/account">Account</Link>
          )}
        </nav>
      )}
    </header>
  );
}
