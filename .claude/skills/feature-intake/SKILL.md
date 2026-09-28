---
name: feature-intake
description: Use FIRST when someone asks for a new feature or a change to an existing one — before any schema, code or test. Works out what is actually being asked for, whether to build it or integrate a third party (Trustpilot, Stripe, Calendly and the like), where the data lives, who may do what, and what happens when the vendor is down. Produces a decision, then hands to feature-schema.
---

# Working out what to build

Most wasted work is not badly built. It is built correctly after nobody asked the second
question. This skill is the second question.

Run it **before** `feature-schema`. It takes minutes and it is the difference between "add
testimonials" meaning a table and meaning a Trustpilot widget — two different products, two
different costs, and the person asking usually has not distinguished them because they had no
reason to.

## Ask about the problem before the feature

A feature request is already a proposed solution. Find out what it is solving, because the
solution may be wrong even when the problem is real.

> "I want a testimonials section."

**1. What goes wrong today without it?**
*"Prospects ask for references and I paste them into email."* — that is the actual problem, and
it might be solved by a page of static quotes rather than an approval workflow.

**2. Who is it for — you, or a visitor?** An internal tool and a public page have almost
nothing in common except the word.

**3. How many, how often?** Six quotes edited twice a year is a content page. Six hundred
arriving weekly is a moderation queue. Same words, different build.

**4. What does done look like?** In their words, so you can both tell when you are finished.

Stop asking once the answers stop changing what you would build. Three good questions beat
eight thorough ones.

## Build, integrate, or neither

Default to **neither**, then **integrate**, then **build** — in that order, because that is
increasing order of what you own forever.

**Neither.** A page of quotes in the CMS needs no table, no moderation, no vendor. If the real
answer is six quotes that change twice a year, say so. The best version of some features is
the one you do not build.

**Integrate** when the value is in the other party's *network*, not their software. Trustpilot
matters because reviews on Trustpilot are trusted by people who do not trust your website. You
cannot self-host that. Same for Google Reviews.

**Build** when the value is in *your* data and workflow. Testimonials you solicit and approve
yourself carry no third-party trust — so a vendor adds a dependency and a bill in exchange for
a form you could have built.

The test: *would a visitor treat this differently because of whose logo is on it?* If yes,
integrate. If no, you are paying for a form.

## What integrating actually costs

These are the questions people skip, and each one has bitten a real deployment.

**Where does the data live?** Theirs means you cannot query it, join it, or take it with you.
Every reporting question becomes an export. Ask directly: *"in a year, do you need to answer
questions about this data alongside your own?"*

**What happens when they are down?** Decide now, not during the outage. Cache the last good
response and serve it stale? Hide the section? Show an error? A page that half-renders because
a widget timed out is the worst of the three, and it is what you get by default.

**What does it cost at ten times the volume?** Per-review, per-seat and per-call pricing all
look free at demo scale.

**Whose data are you sending them?** If a customer's name or email leaves the building, that is
a processor relationship with consent and DPDP/GDPR consequences. It belongs in the privacy
policy before it ships, not after.

**Can you leave?** Export format, and whether the content is yours. Reviews collected on a
platform usually stay on that platform.

**Does it load in the browser or on the server?** A third-party script in the page sees your
visitors and can slow every page it touches. Server-side keeps the key private and the blast
radius small.

## Already wired here

Do not add a second vendor for a job one of these already does:

| | Used for |
|---|---|
| **Resend** | transactional email |
| **Razorpay** | payments |
| **WhatsApp (Meta)** | messaging, OTP |
| **Notion** | gated content pages |
| **n8n** | webhook relays and automation |

n8n in particular absorbs a lot of "we need an integration" requests without new code.

## Then the five that shape the schema

Once build-vs-integrate is settled, these decide the tables. `feature-schema` needs all five.

1. **Who may do what** — who creates, who edits, who approves, who deletes. Names the
   capabilities. "Only I approve" is a different schema from "any editor approves".
2. **Is there a before-it-is-public state?** Draft/approved means a status column and a
   `publish` capability, which is enforced separately from `edit`.
3. **Whose data is it?** A row belonging to a person needs a different policy from a row
   belonging to the site — and it inherits deletion and export obligations.
4. **Does anything outside the app need to reach it?** A webhook in, an API out, an MCP tool.
   Each is a separate surface with its own authentication.
5. **Does this cross to the public template?** Answer now, while it is cheap.
   `docs/PUBLIC_TEMPLATE.md` has the rule; record it in `work-units/session-state.json`. Nothing
   SaaS, tenancy or branding-shaped crosses.

## Say what it will take before starting

A rough shape, and the parts that are not obvious:

> *"Testimonials, built rather than integrated — the trust value is not there for
> self-solicited quotes. One table, an admin screen with approve/reject, a home-page section.
> Roughly a day.*
>
> *Two things worth knowing: approved quotes are public, so anyone who submits one needs to be
> told that at the point of submission. And if you later want Trustpilot as well, these are
> separate systems — this does not become that."*

Then get a yes. A one-line estimate that turns out wrong is recoverable; three days of silence
is not.

## Hand off

- **`feature-schema`** — tables, capabilities, RLS, the migration
- **`feature-testing`** — the browser pass, and the checks that outlive it
- **`site-bootstrap`** — only if this changed branding or company identity

## Do not

- Build the feature as described when the described feature does not solve the stated problem.
  Say so, propose the alternative, and build what they choose.
- Add a vendor without answering the outage question.
- Let a third-party script into the page when a server call would do.
- Skip "does this cross to the template?" — it is cheap now and archaeology later.
- Ask eight questions when three would do. Intake that feels like a form gets answered like a
  form.
