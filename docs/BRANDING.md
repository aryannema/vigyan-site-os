# Branding this template

The repository ships with **no brand** — no logo, no palette, no voice. That is
deliberate: the first commit after cloning should be your identity, not the
removal of somebody else's.

This guide shows how to define one, how to get Claude to apply it consistently,
and what goes wrong when the brand lives in people's heads instead of in a file.

---

## The one rule

**One file is the authority. Everything else refers to it.**

Here that file is `.claude/skills/brand/SKILL.md`. Colour, type, logo rules,
voice and fixed strings live there. The `design` skill covers component
mechanics — how shadcn primitives are wired — and where the two disagree, the
brand file wins.

Without this, brand drifts. One page uses `#1B4D3E`, another `#1C4D3E`, a third
hardcodes `emerald-800` because it looked close. Six months later nobody can say
which is correct, and every new page is a guess.

---

## Worked example

A fictional company, to show the shape. **Do not copy these values** — they are
here so the structure is concrete.

> **Kadamba Field Instruments** — sells soil-moisture sensors to farming
> cooperatives. Buyers are agronomists and cooperative managers, often on a
> phone, often outdoors, often on a slow connection.

That last sentence is the useful one. It is not decoration — it decides things:

| what the audience implies | what it decides |
|---|---|
| read outdoors on a phone | high contrast, large body text |
| slow connections | two fonts at most; no hero video |
| technical buyers | precise copy, real numbers, no superlatives |
| cooperative managers | money and outcomes, not sensor specifications |

### 1. Tokens

```
Ground          #FBFAF7    warm off-white — glare outdoors is the enemy
Ink             #1A1D1A    near-black, not pure black
Muted ink       #5A625A    secondary text — 5.1:1 on Ground, passes AA
Accent          #2F6B4F    a field green; used for one action per screen
Accent ink      #FFFFFF    6.4:1 on Accent — checked, not assumed
Deep surface    #12211A    footer and inverted sections
Border          #E3E0D8
```

Every pair was checked for contrast. `Accent` on `Ground` is **3.9:1** — fine
for a button fill, **not** for body text on the ground colour. Writing that down
is what stops someone using it as a link colour.

```
Display   Source Serif 4    headings — a serif reads as established, not startup
Body      Public Sans       open apertures survive small sizes and bright sun
Mono      IBM Plex Mono     sensor readings, part numbers
Scale     1.250 (major third)
Body      17px              one step up from default: outdoors, on a phone
Measure   ~65 characters
```

Two faces. A third would cost a network request for an audience on a slow
connection.

### 2. Voice, as constraints

Adjectives are useless to an agent. Constraints are not.

```
We write like:      a field engineer explaining a reading to a colleague
We never write:     "revolutionary", "seamless", "unlock", "empower"
Sentence length:    under 20 words; break rather than use a semicolon
Person:             "you" for the reader, "we" for the company
Claims we may make: measured accuracy, stated conditions, warranty terms
Claims we may NOT:  yield improvements — we do not measure yield
```

That last line is the most valuable in the file. It encodes a decision someone
made once, and prevents a plausible sentence that would be a false claim.

### 3. Fixed strings

```
Legal name     Kadamba Field Instruments Pvt Ltd
Short name     Kadamba              (never "KFI", never "Kadamba Instruments")
Tagline        Know the soil before you sow.
Support        support@example.com
```

---

## Getting Claude to apply it

### Load the brand first

```
Load the brand skill, then build the pricing page.
```

Not "build a pricing page and make it look good". The second has no basis for a
visual decision, so the model invents one — and it invents a *different* one
next week.

### Give the audience, not the adjective

Bad:

> Make the hero more modern and professional.

Good:

> The hero is read by a cooperative manager on a phone, outdoors, deciding
> whether to request a quote. One action. Body text 17px minimum.

The second produces a page that can be argued about on evidence.

### Ask it to name the token

When reviewing, ask **"which token is that?"** If the answer is a hex value not
in the brand file, a token is missing. Add it. That question is the whole
maintenance loop.

### Expect to be told when the brand is wrong

The brand skill instructs Claude that it *wins* over the design skill, and that
disagreements should be reported rather than worked around. If you are told the
accent fails contrast as body text, the brand file is wrong and should change —
not the page that surfaced it.

---

## Applying it in code

`components.json` already sets `cssVariables: true` and `baseColor: neutral`, so
shadcn components read variables rather than hardcoded colours.

1. Put the tokens in `app/globals.css` as CSS variables
2. Map Tailwind's theme to those variables in `tailwind.config.ts`
3. **Never edit a file in `components/ui/` to change a colour**

That third rule is the test. If changing a colour means editing a component, a
token is missing. Add the token instead — that is the difference between a design
system and a pile of styled components.

Rebranding should then be editing `globals.css` and swapping files in `public/`.

---

## Before launch

- [ ] Every text/background pair checked — including accent on ground
- [ ] Fonts have a real fallback stack; the page is legible before they load
- [ ] Favicon replaced (the default betrays a template immediately)
- [ ] Fixed strings written down so nobody paraphrases the legal name
- [ ] The "claims we may NOT make" line filled in
- [ ] `docs/A_SITE_THAT_SELLS.md` read — it is about whether the site *works*,
      which is a different question from whether it looks finished
