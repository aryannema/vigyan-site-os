---
name: brand
description: Apply this site's visual identity — colours, type, logo files and fixed brand strings. Use for any page, component, social asset or document that should look like the site.
---

# Brand rules

This is a placeholder identity. The `site-bootstrap` skill interviews the owner
and rewrites this file, `docs/brand/tokens.css`, `src/lib/brand.ts` and the
files in `public/brand/`.

1. **Colours come from `docs/brand/tokens.css` only.** Never hard-code a hex in a
   component; use the Tailwind classes backed by the tokens (`bg-paper`,
   `text-ink`, `bg-saffron-500` = primary, `text-green-ink` = accent …).
   The two literal scales in `tailwind.config.ts` must equal the tokens —
   `pnpm brand:check` enforces it.
2. **Logos and marks come from `public/brand/`** through `<BrandLogo>` and
   `<BrandMark>` (src/components/brand/). Do not redraw, recolour or stretch them.
   `docs/brand/web/` holds byte-identical copies; brand SVGs contain no live text.
3. **Fixed strings** (tagline, label, stance) live in `src/lib/brand.ts`; read
   the constants instead of retyping the words.
4. **Light ground is the default**; the deep surface (`.vb-deep`) is opt-in per section.
5. Keep contrast at WCAG AA or better in both grounds.
