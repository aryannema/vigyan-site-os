"use client";

import { useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import BlogCarousel from "@/components/blog/BlogCarousel";
import { OfferingsMarquee, type OfferingCard } from "@/components/site/OfferingsMarquee";
import ParticleField from "@/components/site/ParticleField";
import RippleField from "@/components/site/RippleField";
import BrandLogo from "@/components/brand/BrandLogo";

type CTA = { label: string; link: string };
type Card = { title: string; description: string };
type Metric = { value: string; label: string };
type JournalPost = { slug: string; title: string; category: string; excerpt: string; date: string };

export type HomeContent = {
  hero: { tagline: string; headingText: string; headingHighlight: string; lead: string; primary: CTA; secondary: CTA };
  product: { eyebrow: string; heading: string; subtitle: string; cards: OfferingCard[] };
  platform: { eyebrow: string; heading: string; description: string; primary: CTA; secondary: CTA; cards: Card[] };
  research: { eyebrow: string; heading: string; metrics: Metric[]; lineage: string };
  journal: { eyebrow: string; heading: string; posts: JournalPost[] };
  philosophy: { eyebrow: string; deva: string; title: string; titleHighlight: string; body: string; cta: CTA };
  cta: { title: string; description: string; primary: CTA; secondary: CTA };
};

/** Render text with literal newlines as <br/>. */
function withBreaks(text: string) {
  const parts = text.split("\n");
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && <br />}
    </Fragment>
  ));
}

export default function HomeExperience({ content }: { content: HomeContent }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll-driven theme shift: the most-centered [data-bg] section drives the
  // body background, body[data-mode], and the ambient blob colors. The header
  // reacts to body[data-mode] via its own observer.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // While on the homepage, force light token base so scheme classes resolve light.
    const hadDark = document.documentElement.classList.contains("dark");
    if (hadDark) document.documentElement.classList.remove("dark");

    const blob1 = document.querySelector<HTMLElement>(".ambient .b1");
    const blob2 = document.querySelector<HTMLElement>(".ambient .b2");
    const secs = Array.from(root.querySelectorAll<HTMLElement>("[data-bg]"));
    let current: HTMLElement | null = null;

    const apply = (el: HTMLElement) => {
      if (el === current) return;
      current = el;
      const { bg, mode, g1, g2 } = el.dataset;
      if (bg) document.body.style.backgroundColor = bg;
      if (mode) document.body.dataset.mode = mode;
      if (g1 && blob1) blob1.style.backgroundColor = g1;
      if (g2 && blob2) blob2.style.backgroundColor = g2;
    };

    const obs = new IntersectionObserver(
      (entries) => {
        let best: HTMLElement | null = null;
        let bestRatio = 0;
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio >= bestRatio) {
            best = e.target as HTMLElement;
            bestRatio = e.intersectionRatio;
          }
        });
        if (best) apply(best);
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    secs.forEach((s) => obs.observe(s));
    if (secs[0]) apply(secs[0]);

    return () => {
      obs.disconnect();
      document.body.style.backgroundColor = "";
      delete document.body.dataset.mode;
      if (blob1) blob1.style.backgroundColor = "";
      if (blob2) blob2.style.backgroundColor = "";
      if (hadDark) document.documentElement.classList.add("dark");
    };
  }, []);

  const c = content;

  return (
    <div ref={rootRef}>
      {/* ===== HERO (light / paper) ===== */}
      <section className="sec" data-bg="#faf6ee" data-mode="light" data-g1="rgba(245,158,11,.30)" data-g2="rgba(34,197,94,.12)" style={{ padding: 0, backgroundColor: "#faf6ee" }}>
        <div className="wrap hero">
          <ParticleField count={70} />
          <RippleField />
          <div>
            {c.hero.tagline ? (
              <span className="eyebrow" style={{ color: "var(--vb-saffron-700)" }}>{c.hero.tagline}</span>
            ) : null}
            {/* Hero lockup, added on operator request 2026-09-17. This is a
                DELIBERATE reversal of the earlier "no mark here" rule (STEP 7B
                rule 7, one brand mark per screen) -- the header lockup is also
                in this viewport, so there are two. If that ever needs undoing,
                the cleaner fix is to hide the header lockup until #hdr is
                .scrolled rather than to drop this one.
                The `primary` lockup is used, never `tagline`: BrandLogo's
                contract is that a tagline in a hero must be real HTML text,
                which is exactly what the <h1> below already is. That is why
                nothing is duplicated here -- the tagline IS the heading, and
                it now sits directly beneath the mark. */}
            <BrandLogo
              lockup="primary"
              on="ivory"
              className="mb-6 h-11 w-auto md:h-14"
              priority
            />
            <h1>
              {withBreaks(c.hero.headingText)}
              {c.hero.headingHighlight ? (<><br /><span style={{ color: "var(--vb-saffron-700)" }}>{c.hero.headingHighlight}</span></>) : null}
            </h1>
            <p className="lead">{c.hero.lead}</p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href={c.hero.primary.link}>{c.hero.primary.label}</Link>
              <Link className="btn btn-ghost btn-lg" href={c.hero.secondary.link}>{c.hero.secondary.label}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PRODUCT (sand) ===== */}
      <section id="product" className="sec" data-bg="#f3ecdd" data-mode="light" data-g1="rgba(245,158,11,.24)" data-g2="rgba(252,211,77,.16)" style={{ backgroundColor: "#f3ecdd" }}>
        <ParticleField count={50} />
        <div className="wrap">
          <div className="sec-head center">
            <span className="eyebrow" style={{ color: "var(--vb-saffron-700)" }}>{c.product.eyebrow}</span>
            <h2 style={{ color: "var(--vb-ink-900)" }}>{c.product.heading}</h2>
            <p className="sub" style={{ color: "var(--vb-ink-700)" }}>{c.product.subtitle}</p>
          </div>
          <div style={{ marginTop: 40 }}>
            <OfferingsMarquee cards={c.product.cards} direction="right" speed="fast" />
          </div>
        </div>
      </section>

      {/* ===== PLATFORM / VVC (dark slate) ===== */}
      <section id="platform" className="sec on-dark-sec" data-bg="#020617" data-mode="dark" data-g1="rgba(245,158,11,.40)" data-g2="rgba(34,197,94,.34)" style={{ backgroundColor: "#020617" }}>
        <ParticleField count={45} />
        <div className="wrap">
          <div className="philo">
            <div>
              <span className="eyebrow" style={{ color: "var(--vb-saffron-400)" }}>{c.platform.eyebrow}</span>
              <h2 style={{ color: "#fff", marginTop: 14 }}>{withBreaks(c.platform.heading)}</h2>
              <p style={{ color: "var(--vb-mist-300)", marginTop: 18 }}>{c.platform.description}</p>
              <div className="cta" style={{ marginTop: 28 }}>
                <Link className="btn btn-primary" href={c.platform.primary.link}>{c.platform.primary.label}</Link>
                <Link className="btn btn-ghost" href={c.platform.secondary.link}>{c.platform.secondary.label}</Link>
              </div>
            </div>
            <div className="cards" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {c.platform.cards.map((card, i) => (
                <div className="card" key={i}>
                  <h3>{card.title}</h3>
                  <p>{card.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== RESEARCH / GROWTH (deep green) ===== */}
      <section id="research" className="sec on-dark-sec" data-bg="#06231a" data-mode="dark" data-g1="rgba(34,197,94,.44)" data-g2="rgba(21,128,61,.34)" style={{ backgroundColor: "#06231a" }}>
        <ParticleField count={45} />
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow" style={{ color: "var(--vb-green-300)" }}>{c.research.eyebrow}</span>
            <h2 style={{ color: "#fff" }}>{c.research.heading}</h2>
          </div>
          <div className="metrics">
            {c.research.metrics.map((m, i) => (
              <div className="metric" key={i}>
                <div className="v" style={{ color: "var(--vb-green-300)" }}>{m.value}</div>
                <div className="l" style={{ color: "#bfe6cf" }}>{m.label}</div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 48, fontSize: 14, color: "#7fbf9b", fontFamily: "var(--font-mono)", letterSpacing: ".05em" }}>{c.research.lineage}</p>
        </div>
      </section>

      {/* ===== JOURNAL / BLOG (light paper, only when posts exist) ===== */}
      {c.journal.posts.length > 0 && (
        <section className="sec" data-bg="#f7f1e4" data-mode="light" data-g1="rgba(245,158,11,.20)" data-g2="rgba(34,197,94,.10)" style={{ backgroundColor: "#f7f1e4" }}>
          <ParticleField count={40} />
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow" style={{ color: "var(--vb-saffron-700)" }}>{c.journal.eyebrow}</span>
              <h2 style={{ color: "var(--vb-ink-900)" }}>{c.journal.heading}</h2>
            </div>
            <div style={{ marginTop: 40 }}>
              <BlogCarousel posts={c.journal.posts} />
            </div>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <Link className="btn btn-ghost" href="/blog">Read the journal</Link>
            </div>
          </div>
        </section>
      )}

      {/* ===== COMPANY / PHILOSOPHY (warm saffron paper) ===== */}
      <section id="company" className="sec" data-bg="#fbf1df" data-mode="light" data-g1="rgba(245,158,11,.32)" data-g2="rgba(252,211,77,.20)" style={{ backgroundColor: "#fbf1df" }}>
        <ParticleField count={40} />
        <div className="wrap philo">
          <div>
            <span className="eyebrow" style={{ color: "var(--vb-saffron-700)" }}>{c.philosophy.eyebrow}</span>
            <div className="deva" style={{ marginTop: 18 }}>{withBreaks(c.philosophy.deva)}</div>
          </div>
          <div>
            <p style={{ color: "var(--vb-ink-900)", fontSize: 22, fontWeight: 600, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--vb-saffron-700)" }}>{c.philosophy.titleHighlight}</strong>
              {c.philosophy.title}
            </p>
            <p style={{ color: "var(--vb-ink-700)", marginTop: 14 }}>{c.philosophy.body}</p>
            <Link className="btn btn-ghost" style={{ marginTop: 24 }} href={c.philosophy.cta.link}>{c.philosophy.cta.label}</Link>
          </div>
        </div>
      </section>

      {/* ===== CTA (warm ink) ===== */}
      <section className="cta-band" data-bg="#1c1814" data-mode="dark" data-g1="rgba(245,158,11,.36)" data-g2="rgba(34,197,94,.24)" style={{ backgroundColor: "#1c1814" }}>
        <ParticleField count={40} />
        <div className="wrap">
          <h2>{c.cta.title}</h2>
          <p>{c.cta.description}</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="btn btn-primary btn-lg" href={c.cta.primary.link}>{c.cta.primary.label}</Link>
            {c.cta.secondary.link.startsWith('http') ? (
              <a className="btn btn-ghost btn-lg" style={{ color: "#fff", borderColor: "rgba(255,255,255,.25)" }} href={c.cta.secondary.link} target="_blank" rel="noopener noreferrer">{c.cta.secondary.label}</a>
            ) : (
              <Link className="btn btn-ghost btn-lg" style={{ color: "#fff", borderColor: "rgba(255,255,255,.25)" }} href={c.cta.secondary.link}>{c.cta.secondary.label}</Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
