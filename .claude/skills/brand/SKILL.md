---
name: brand
description: Use when applying or defining this site's visual identity — colour, typography, logo usage, copy voice, the fixed strings. THIS FILE IS A TEMPLATE and ships deliberately empty of any brand; fill it in for your project before building pages. On any disagreement with the design skill, this file wins.
---

# Brand — fill this in first

**This template ships with no brand.** That is the point of the repository: you
clone it and the first thing you own is your own identity, rather than deleting
somebody else's.

This file is the **authority** on colour, type, logo and voice. The `design`
skill covers component *mechanics* — how shadcn primitives are wired, how the
form layer validates. Where the two disagree, **this file wins**, and the design
skill should be corrected rather than worked around.

Until you complete section 1, an agent building pages has no basis for a visual
decision and will invent one. Inventing one is worse than asking.

---

## 1. Tokens — the single source

Put real values here, then mirror them into `app/globals.css` as CSS variables.
`components.json` already sets `cssVariables: true` and `baseColor: neutral`, so
components read variables and never hardcode a colour.

```
Ground            #______      the page background
Ink               #______      body text on Ground
Muted ink         #______      secondary text — must still pass AA
Accent            #______      one colour, used sparingly
Accent ink        #______      text ON Accent — check contrast, do not assume
Deep surface      #______      inverted sections, footers
Border            #______
```

**Contrast is not optional.** Body text needs 4.5:1 against its background, large
text 3:1. Check every pair you define, including accent-on-ground, which is the
one that usually fails.

```
Display face      ____________   headings
Body face         ____________   running text
Mono face         ____________   code, data
Scale             ____________   e.g. 1.250 major third
Body size         ____ px
Measure           ~65 characters
```

Two faces is usually right. One reads as unfinished; three rarely earns the
weight it adds.

## 2. Logo

```
Primary mark      public/______
Wordmark          public/______
Favicon           public/______
Minimum size      ____ px
Clear space       ____ (usually the height of one letter)
```

Rules worth writing down because they get broken: never recolour the mark, never
place it on a background that drops below 3:1 contrast, never stretch
non-uniformly, and never reconstruct the wordmark by typing it in the display
face.

## 3. Voice

State it as constraints, not adjectives — "friendly and professional" tells an
agent nothing.

```
We write like:        ______________________
We never write:       ______________________
Sentence length:      ______________________
Person:               first ("we") / second ("you") / neither
Claims we may make:   ______________________
Claims we may NOT:    ______________________
```

Write down the **fixed strings** so nobody paraphrases them: legal name, tagline,
product names with their exact capitalisation, address, support email.

## 4. Fill-in checklist

- [ ] Tokens defined here and mirrored into `app/globals.css`
- [ ] Every text/background pair checked for contrast
- [ ] Fonts loaded and a real fallback stack declared
- [ ] Logo files in `public/`, favicon replaced
- [ ] Fixed strings written down
- [ ] Voice constraints written as rules
- [ ] `docs/A_SITE_THAT_SELLS.md` read — it is about whether the site *works*, not whether it looks finished

## 5. Applying it

Rebranding should be editing variables, not components. If you find yourself
editing a file in `components/ui/` to change a colour, a token is missing —
add the token instead. That is the difference between a design system and a
collection of styled components.

Load `design` for component mechanics. Load `seo-optimize` before launch.
