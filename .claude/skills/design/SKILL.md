---
name: design
description: Use when wiring shadcn/ui primitives, forms or admin UI in this site — the component mechanics, the VBField validation layer, and the UI bugs that have actually shipped here. For brand identity (colour, type, logo, voice) load brand instead; that skill wins on any disagreement.
---

# your brand — component mechanics

**Scope: how components are wired.** For the brand itself — colour, type,
logo usage, the fixed strings, copy voice — the authority is the
`brand` skill (`docs/brand/SKILL.md`, revision 4). Where this file
and that one disagree, **the brand skill wins**; tell the operator so this one
can be corrected rather than quietly working around it.

This template ships **no brand**. Colour, type and voice come from the
`brand` skill, which you fill in for your own project. Where this file and
that one disagree, **the brand skill wins**.

## 0. The one idea

shadcn components are **not themed from the outside**. Each reads a fixed set of
CSS variables (`--primary`, `--border`, `--ring`, `--radius`…). Those variables
are re-pointed at brand values in `src/app/globals.css`, so all 40+ primitives —
including ones added next year — render in brand with **zero forked files**.

**Never hard-code a colour in a component.** If something looks wrong, the fix is
almost always a token, not a `className`.

## 1. Where things actually live (this repo, Tailwind v3)

| What | Where |
|---|---|
| Brand tokens (source of truth) | `docs/brand/tokens.css`, imported once at the top of `src/app/globals.css` |
| App-only tokens + the shadcn bridge | `src/app/globals.css` (`:root` and `.dark, .vb-deep`) |
| Logo/mark components | `src/components/brand/{BrandLogo,BrandMark}.tsx` — never hand-assemble a lockup |
| Fixed brand strings | `src/lib/brand.ts` |
| Tailwind colour/radius mapping | `tailwind.config.ts` |
| shadcn primitives | `src/components/ui/` |
| Validation layer | `src/components/ui/vb-field.tsx` |

**Do NOT add a second theme file.** The brief ships a standalone
`your-site-shadcn-theme.css`; its contents are already merged into
`globals.css`. Adding it back creates the exact two-sources-of-truth breakage
the brief itself warns about.

**Tailwind is v3 here** (`@tailwind base/components/utilities`, `tailwind.config.ts`).
Ignore v4 instructions: no `@theme inline`, no `@import "tailwindcss"`.

**Hex, not HSL channels.** Config references variables directly —
`primary: 'var(--primary)'`, never `hsl(var(--primary))`. Wrapping them in
`hsl()` makes every colour resolve to nothing.

## 2. Token map

Moved. The colour table, the type roles and the fixed strings are in the
**`brand`** skill and in `docs/brand/DESIGN-SYSTEM.md` §4-5.
Duplicating them here is what let this file go stale against revision 4.

One repo-specific gotcha that is NOT in the brand pack and still applies:

`muted` in this repo is a **text** colour (`text-muted` is used site-wide),
whereas shadcn means it as a **surface**. Use `bg-sand` for that surface and
`text-muted-foreground` for shadcn's text meaning. Don't "fix" this by
redefining `muted` — it silently wrecks every `text-muted` on the public site.

A second one, load-bearing for the build: the `saffron` and `green` scales in
`tailwind.config.ts` are hex literals, not `var()`. Tailwind v3 rewrites
opacity modifiers (`bg-saffron-500/10`) into `rgb(... / <alpha-value>)` and
cannot do that arithmetic on a var() holding a hex, so switching them breaks
every alpha class at build time. `pnpm brand:check` asserts they stay equal to
`docs/brand/tokens.css`.

## 3. Per-component rules

Anything not listed needs **no** change — tokens cover it.

| Component | Rule |
|---|---|
| `button` | `default` = saffron with **ink** text. Never `text-white`. `secondary` = transparent + 1.5px `border-input`, hover warms to saffron. Hover lifts 1px. |
| `toggle` / `toggle-group` | Pressed = **saffron tint at 14% behind a saffron hairline** (edit the cva variant). shadcn's default `bg-accent` solid fill reads as a primary button — wrong by default. |
| `card` | Opt in to `className="vb-card-accent"` for the 3px saffron top rule that grows on hover. Not automatic. |
| `input` / `textarea` | Prefer `VBField` (§4) in any validating form. Border: `border-input` → `border-destructive` on error → `border-accent` when valid. |
| `badge` | Four variants: saffron tint (default), green tint (success), outline, red tint (destructive). Mono, uppercase, `0.12em` tracking, pill radius. |
| `alert` | Tinted bg at ~8% of its semantic colour + matching 30% border. **Left-border accent stripes are banned.** |
| `dialog`/`alert-dialog`/`sheet`/`drawer` | Overlay `var(--overlay)` (warm), never neutral black. Panel radius `28px`. No glassmorphism on light. |
| `tooltip` | Dark ink panel (`#1c1814`) with paper text, even in light mode. |
| `tabs` | Underline: 2px saffron bottom border on active trigger. Not pill/segmented. |
| `accordion` | Chevron → `+` rotating 45° to `×`. Open panel gets sand background. |
| `sidebar` | Ground is **sand, not white**. Active item = white surface + `shadow-xs`. |
| `chart` | Use `--chart-1…5`. Grid at 6% ink; axis labels mono 9–10px. |
| `calendar` | Selected day = saffron tint + saffron hairline + ink text. Never solid saffron fill. |
| `skeleton` | Solid `#ece2cf`. **No shimmer animation.** |

### Cross-cutting (already global in `globals.css` — don't re-add per component)

1. **Focus** — 3px saffron ring at 18%, no offset, set on `:focus-visible`.
   **Do not add per-component `focus:ring-2`.**
2. **Motion** — `var(--ease-out)` = `cubic-bezier(0.16,1,0.3,1)`, 120–220ms.
   Confident settle, never a bounce. `prefers-reduced-motion` handled globally.
3. **Radius** — never sharp corners.
4. **No emoji, ever.** Affirmations use `✓` in a tinted green circle.
5. **Icons** — Lucide, 1.5–2px stroke, `currentColor`, no fill.

## 4. Validation layer — `VBField`

Rules are **data, not code**. A field carries its own contract, runs it on blur
and submit, owns its error slot, reports validity upward.

```tsx
<VBField
  name="key" label="Deployment key" hint="required · min 12" secret
  value={v.key} values={v} submitted={submitted}
  rules={[{ kind: 'required' }, { kind: 'min', value: 12 }]}
  onChange={(key) => setV({ ...v, key })}
/>
```

Rule kinds: `required · email · min · max · pattern · match · custom`.
`secret` adds the eye reveal toggle.

**Server-side: import `runRules` from the same module and re-run the identical
rule array in the route handler.** One contract, both sides — never write a
second set of checks.

Use `VBField` for contact/onboarding/settings forms. Raw `Input` is fine for
search boxes and other non-validating inputs.

## 4b. Failure modes that have actually shipped here

Every item below is a real bug caught on this site, not theory. Check these
explicitly — they all passed typecheck and build.

### Text contrast
- **Never assume an inherited colour.** A `.cta-band p` with no explicit
  `color` rendered near-invisible on its dark band. Any element on a coloured
  or dark ground needs its colour stated.
- **Ink on saffron, never white.** White on `#f59e0b` fails contrast. This is
  what `--primary-foreground: #1c1814` is for.
- Dark bands: use `.vb-dark`, which sets both background *and* foreground.
  Setting only the background leaves inherited light-mode text on it.

### Alignment / positioning
- **An `absolute` child needs BOTH axes anchored.** A toggle knob with
  `absolute top-0.5` but no `left-0.5` fell back to a static horizontal
  position (`left: 22px`), so the on/off `translate-x` shifted from the wrong
  origin and every switch looked broken. Verify with `getComputedStyle`, not
  by eye.
- **A `fixed` header needs top clearance on centered pages.** `min-h-[80vh]
  flex items-center` wrappers rendered their top content *under* the 72px
  fixed header. Add `pt-24` on such pages.
- **Watch CSS shorthand overriding a sibling class.** `.hero { padding: … }`
  silently killed `.wrap { padding: 0 28px }` on the same element (source
  order). Use longhand (`padding-top`/`padding-bottom`) when two classes share
  an element.

### Dead / placeholder UI
- A form whose submit button has no `onClick`/`onSubmit`/action is worse than
  no form — it implies a working feature. Either wire it or delete it.

## 4c. Validation — the rule for every input

Any input that can be wrong gets a rule. No exceptions, no bespoke per-form
validation logic.

| Input | Minimum rules |
|---|---|
| Email | `required` + `email` |
| Password | `required` + `min` (8+) |
| Confirm password | `required` + `match` |
| Phone / WhatsApp | `required` + `pattern` (digits, country code) |
| Name fields | `required` + `max` |
| URL | `required` (if mandatory) + `pattern` |
| Numeric config | `required` + `min`/`max` bounds |
| Search / filter | none — non-validating, raw `Input` is fine |

Rules live in **one array**, used by both the client field and the server route
(`runRules`). If a route handler re-implements a check the field already
declares, that's a bug — they will drift.

Feedback states are token-driven, never ad-hoc colours: error =
`border-destructive` + `text-destructive`, valid = `border-accent` +
`text-accent`, neutral = `border-input`. Error text goes in the field's own
slot with `role="alert"`, and the slot keeps its height when empty
(`min-h-4`) so the layout doesn't jump.

## 5. Copy voice

Moved to the **`brand`** skill (and `docs/brand/DESIGN-SYSTEM.md`
§3), which also carries the three fixed strings and the banned-word list.
`src/lib/brand.ts` exports those strings as constants — use them rather than
retyping.

## 6. Before you call UI work done

- [ ] No component file hard-codes a hex colour.
- [ ] `bg-primary` renders saffron; `text-primary-foreground` renders **ink**, not white.
- [ ] Tab-focus shows a saffron ring, not a blue browser outline, and no component adds its own.
- [ ] Toggle pressed states are tints, not solid fills.
- [ ] Validating forms use `VBField`; the route handler imports `runRules` from it.
- [ ] Generic Tailwind palettes (`slate-*`, `gray-*`, `blue-*`, `zinc-*`) are not used —
      they read cold against the warm ground. Use `ink`/`hairline`/`sand`/`muted`.
- [ ] Verified against a real production-style build, not just `pnpm dev` —
      `dynamic`/prerender bugs and stale `.next-stable` type caches don't show up in dev.
