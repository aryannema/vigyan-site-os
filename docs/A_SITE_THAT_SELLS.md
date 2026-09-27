# A site that sells

The template renders pages. What goes on them is the part that decides whether anyone contacts
you, and it is not a design question.

This is our own synthesis, written for whoever adopts this template. It is opinionated. Disagree
with it deliberately rather than by default.

---

## The one idea underneath everything else

**A visitor runs a silent commentary while scrolling.** Each section either answers their next
question or wastes the scroll.

Most sites are ordered by the company's org chart — what we do, who we are, our values, contact.
The visitor does not care about any of that yet. A page converts when it is ordered by *their*
questions instead.

So write the questions down first. For most businesses they run roughly:

1. Is this for someone like me?
2. Does it actually work?
3. Who says so, other than you?
4. What does it cost, and what is the catch?
5. What happens if it goes wrong?
6. What is the smallest next step?

**Your order will differ, and the differences are the interesting part.** A B2B buyer signing a
six-figure contract asks about risk and references. Someone buying a ₹500 course asks whether it
is worth an evening. Same template, opposite page.

---

## Order proof before the ask

The most common structural mistake: a hero, then a call to action, then — further down — the
reasons to trust you.

That asks for commitment before giving a reason for it. Reverse it. Evidence, then the ask.

**Your strongest asset is usually further down the page than it should be.** Find the one thing
a sceptical visitor would find most convincing — a named client, a number, a result — and move
it up. If you have to scroll to reach it, it is doing nothing.

---

## Proof is not one thing

There are two kinds and they do not substitute for each other.

**Volume proof** — review counts, customer totals, download numbers. Works when the decision is
small and fast. "Forty thousand people bought this" is genuinely reassuring for a ₹500 purchase.

**Specificity proof** — one named organisation, one named problem, one number attached to the
outcome. Works when the decision is large and slow, or when the buyer will have to justify it to
someone else.

Using the wrong one actively hurts. Volume proof on a high-value B2B page reads as consumer
marketing and makes a serious buyer wonder who your real customers are. Specificity proof on a
cheap consumer product reads as slow and corporate.

**Decide which you are before writing a single number.**

---

## Answer the objection before it is conscious

Every buyer has one thing that stops them, and they usually have not articulated it. If the page
does not answer it, they leave without knowing why.

Find yours by asking people who did *not* buy. It is almost never the price itself — it is
something underneath the price:

| Business | The real objection |
|---|---|
| expensive service | *will this actually be finished* |
| anything handling data | *where does my data go* |
| a new product | *will you still exist in two years* |
| something technical | *will I be able to use it* |

Answer it in plain words, on the page, before the ask. A sentence that names the fear directly
is worth more than a page of features.

---

## Silence about price is not neutral

A page with no pricing and no range reads as *expensive, and evasive about it.*

You do not need a price list. You need one of these:

- a starting figure — *"engagements start at X"*
- a range with what moves it
- an explanation of how you scope
- an honest reason — *"it depends on N, so here is how we work it out"*

The buyer is trying to decide whether to spend twenty minutes on a call. Give them enough to
self-select out. **The enquiries you lose to a published price were never going to close.**

---

## Make the call to action small

"Get in touch" asks for an unbounded commitment: an unknown-length conversation with a
salesperson toward an unknown outcome. It is the weakest possible ask.

Replace it with something bounded and specific. *"Send us X and we will tell you Y — free, back
in two days."* That is a smaller ask and it is also a filter: the people who take it are people
with the problem.

Keep one primary action per page. Two competing buttons is a choice, and a visitor who has to
choose often leaves instead.

---

## Say one honest negative thing

Every competitor's site claims only success. A page that admits a limit — who this is *not* for,
what it does not do, what happens when something goes wrong — is more believable than one that
does not.

It also works as a filter, which saves you the calls you did not want.

This is the cheapest credibility available and almost nobody uses it.

---

## Applying it with this template

**Editable sections, not hardcoded copy.** Put every line in `site_content` and edit it at
`/admin/cms`. Copy that lives in JSX needs a deploy to change, so it never gets changed, so it
stays wrong.

```tsx
const hero = await getSection('hero');
const proof = await getSection('proof');
```

**One featured post, not eight equal ones.** The blog list defaults to a uniform grid. Eight
equal cards is no recommendation at all — feature one, demote the rest.

**Route the CTA to a real form.** `contact_inquiries` and `/admin/crm` exist. A form that lands
somewhere you actually look beats a `mailto:` you forget.

---

## Contrast is a conversion problem

Low-contrast body text is how a page reads as *not worth the effort* to someone skimming on a
phone in daylight. It is usually filed under accessibility and treated as compliance, which is
why it goes unfixed.

It is more direct than that: **if the copy cannot be read, none of the above matters.** Run an
automated pass, fix what it finds, and check the page outdoors.

---

## Measure something, or this is just opinion

Before you rewrite anything, record:

- enquiry rate per unique visitor, split by landing page
- scroll depth on the home page — what fraction reach your strongest proof today
- form starts versus form completions

Without a baseline, the next person's opinion carries exactly as much weight as yours, and you
will rewrite the page again in six months on a hunch.

---

## The short version

```
order by the visitor's questions, not your org chart
proof before the ask
specificity for big decisions, volume for small ones
name the objection before it is conscious
say something about price
make the ask small and specific
admit one real limit
make sure it can actually be read
measure before and after
```
