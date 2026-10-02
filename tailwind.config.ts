import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: 'class',
  content: ['./src/app/**/*.{js,ts,jsx,tsx,mdx}', './src/components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Brand revision 4 type roles. Every entry points at a token from
      // docs/brand/tokens.css (bridged to next/font in globals.css) rather
      // than naming a family directly.
      //   font-display → Newsreader 600, headings and the tagline italic
      //   font-sans    → Public Sans, body (the default)
      //   font-mono    → JetBrains Mono, tracked uppercase labels
      //   font-deva    → Noto Sans Devanagari; NEVER apply tracking to it
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-body)'],
        deva: ['var(--font-deva)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        // ---- Brand tricolor accents (constant across themes) -------------
        // NOTE — why these two scales are literals while everything else below
        // is var(): Tailwind v3 computes opacity modifiers (bg-saffron-500/10,
        // border-green-700/25 — 19 distinct ones are in use) by rewriting the
        // colour into rgb(... / <alpha-value>). It cannot do that arithmetic on
        // a var() holding a full hex, so `var(--vb-saffron-500)` breaks every
        // such class at build time. The values here MIRROR docs/brand/tokens.css
        // exactly and must never diverge; `pnpm brand:check` asserts that.
        saffron: {
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9', // primary
          600: '#0284c7',
          700: '#0369a1', // text-safe primary
        },
        green: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6', // accent
          600: '#7c3aed',
          700: '#6d28d9', // text-safe accent
        },
        // ---- Legacy aliases (kept so existing admin classes keep working) -
        brand: {
          primary: 'var(--vb-saffron-500)',
          bytes: 'var(--vb-green-500)',
          energy: 'var(--vb-saffron-500)',
          'energy-light': '#bae6fd',
          dark: 'var(--vb-deep)',
          surface: 'var(--vb-deep-surface)',
        },
        // ---- Semantic, theme-flipping tokens (driven by CSS vars) ---------
        paper: 'var(--bg)',
        sand: 'var(--bg-alt)',
        well: 'var(--bg-well)',
        surface: 'var(--surface)',
        ink: 'var(--text-strong)',
        body: 'var(--text-body)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        'saffron-ink': 'var(--primary-ink)',
        'green-ink': 'var(--accent-ink)',
        hairline: 'var(--border)',
        'hairline-strong': 'var(--border-strong)',
        'hairline-faint': 'var(--border-faint)',

        // ---- shadcn/base-ui semantic aliases ------------------------------
        // src/components/ui/* (shadcn "base-nova" primitives) and the admin
        // surface are written against the standard
        // shadcn token names. They are ALIASES onto the site's CSS
        // variables above — deliberately not a second palette. Adding them is
        // purely additive: none of these names existed before, so no existing
        // class changes meaning.
        //
        // `muted` is the one shadcn name deliberately NOT defined here: this
        // repo already binds `muted` to var(--text-muted) (a TEXT colour, used
        // as `text-muted` site-wide) whereas shadcn means it as a SURFACE.
        // Redefining it would silently wreck every `text-muted` on the public
        // site, so ported code uses `bg-sand` for that surface instead and
        // `text-muted-foreground` for the text colour.
        background: 'var(--bg)',
        foreground: 'var(--text-strong)',
        card: 'var(--surface-card)',
        'card-foreground': 'var(--text-strong)',
        popover: 'var(--surface-card)',
        'popover-foreground': 'var(--text-strong)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--on-primary)',
        secondary: 'var(--bg-alt)',
        'secondary-foreground': 'var(--text-body)',
        'muted-foreground': 'var(--text-muted)',
        // `accent` is the brand accent scale -- not a
        // neutral surface tint. It was previously aliased to var(--bg-alt); no
        // code used bg-accent/text-accent at the time of the change (verified
        // by grep), so this redefinition is safe. VBField depends on it for
        // its valid-state border/text.
        accent: 'var(--accent-ink)',
        'accent-foreground': 'var(--vb-surface)',
        destructive: '#b91c1c',
        'destructive-foreground': 'var(--vb-surface)',
        border: 'var(--border)',
        input: 'var(--border-strong)',
        ring: 'var(--focus-ring)',
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
        overlay: 'var(--overlay)',
      },
      borderRadius: {
        // Brand: soft, generous radii (added alongside Tailwind defaults).
        card: '20px',
        feature: '28px',
        // shadcn's own scale, driven by --radius (CLAUDE-BRIEF.md §2).
        // Deliberately NOT overriding Tailwind's default `lg`/`xl` here --
        // those are used site-wide at their stock values; shadcn primitives
        // that want the brand card/feature radii use rounded-card/-feature.
        'ui-sm': 'calc(var(--radius) - 4px)',
        'ui-md': 'calc(var(--radius) - 2px)',
        'ui-lg': 'var(--radius)',
      },
      boxShadow: {
        'warm-sm': 'var(--shadow-sm)',
        'warm-md': 'var(--shadow-md)',
        'warm-lg': 'var(--shadow-lg)',
        'glow-saffron': '0 0 0 1px rgba(245,158,11,0.18), 0 12px 32px rgba(245,158,11,0.18)',
        'glow-green': '0 0 0 1px rgba(34,197,94,0.16), 0 12px 32px rgba(21,128,61,0.16)',
      },
      letterSpacing: {
        // Brand label tracking (DESIGN-SYSTEM.md §3): the PRODUCTION-GRADE…
        // label is JetBrains Mono uppercase at 0.28em, always one line.
        label: '0.28em',
        eyebrow: '0.18em',
      },
      transitionTimingFunction: {
        out: 'var(--ease)',
      },
      keyframes: {
        marquee: {
          to: { transform: 'translateX(-50%)' },
        },
        scroll: {
          to: { transform: 'translate(calc(-50% - 0.5rem))' },
        },
      },
      animation: {
        marquee: 'marquee 28s linear infinite',
        scroll: 'scroll var(--animation-duration, 40s) var(--animation-direction, forwards) linear infinite',
      },
    },
  },
  // `prose` was already used by /privacy and /blog/[slug] (complete with
  // prose-headings:/prose-p: modifiers) before this plugin existed, so those
  // classes were silently inert. Registering it makes them do what the markup
  // has always said it wanted.
  plugins: [typography],
};

export default config;
