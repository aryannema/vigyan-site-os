# Roadmap

What is built, what is half-built, and what is not there at all — so you can
tell before you clone rather than after.

Everything marked **built** was exercised against a running server and a real
database. Everything marked **WIP** or **not started** is honest about it,
because a template that overstates itself wastes more of your time than one that
does less.

## Built

| | |
|---|---|
| Database-enforced permissions | `user_has_capability`, `perform_action` |
| Column-level rules RLS cannot express | trigger: edit a post but not publish it |
| Audit by construction | two independent layers, verified |
| CRM with capability-gated PII | `contact_inquiries_view`, `security_barrier`, masked email and phone |
| Row-level security | enabled on 16 tables |
| Nine admin screens | blog, CMS, careers, CRM, media, users, capabilities, AI settings |
| MCP agent endpoint | 11 tools, same capability checks |
| JWT auth with refresh | short access tokens, type-confusion tested both ways |
| AI provider as configuration | `ai_provider_config`, swapped from the admin UI |
| 12 Claude skills | feature intake through deployment |
| Test suites | 5 vitest + 24 end-to-end assertions |

## WIP — the read side exists, the write side does not

### Contact form — the table and the admin screen, not the form

`contact_inquiries` exists, `/admin/crm` reads it through the masking view, and
the whole capability-gated privacy model above is **built and working**.

What is missing is the **public form that writes into it.** The shipped public
pages are `/`, `/login` and `/pending-approval` — there is no `/contact`. So
today the CRM is a working inbox with no letterbox attached.

Adding one is deliberately small: a form, a server action, an insert. A version
of it exists upstream, so this is extraction rather than design.

The reason it was not extracted is that a contact form worth shipping needs a
spam defence and a consent checkbox, and both are decisions a site owner should
make rather than inherit from a template.

### OTP verification — built upstream, not here

No OTP in this repository: not email, not SMS, not WhatsApp.

It **is** built upstream — phone verification and account-deletion confirmation,
both over WhatsApp — so the pattern is proven rather than theoretical. See
"Built upstream" below for what porting it involves, and note that it inherits
WhatsApp's fragility: a suspended WABA number cannot deliver a code, so an OTP
flow with no second channel locks people out of their own accounts.

### Services — no table, no pages

A services or products catalogue is a common need and is **not modelled**. Blog,
CMS sections, careers and CRM are; services are not. Adding it is the worked
example in `feature-intake` → `feature-schema` if you want to see the workflow
on something real.

## Built upstream, not yet extracted

This template was extracted from a production site, and the extraction stopped
at the generic parts. The integrations below are **written, deployed and
running there** — they are absent here because each is entangled with one
business's accounts, copy and compliance decisions, not because they are
unsolved.

Listing them matters for two reasons: you know the path exists rather than
guessing, and you know what you are signing up for if you want it.

| | what exists upstream | why it is not here |
|---|---|---|
| **GA4** | a `<GA4>` component plus a reporting client using a GCP service account | tied to one property ID and one service account |
| **Google Search Console** | Search Console Data API client, URL inspection, an SEO admin screen | reuses the *same* service account as GA4; needs per-site access grants |
| **IndexNow** (Bing, Yandex) | fire-and-forget ping on publish, **no secrets at all** | the simplest to port — see below |
| **WhatsApp Business** | webhook, conversation resolution, OTP verification, deletion verification | one WABA, one phone number, template approvals |
| **OTP** | phone verification and account-deletion confirmation over WhatsApp | depends on WhatsApp above |
| **Razorpay** | checkout quote and order, webhook, invoice generation | one merchant account, and real money |
| **Transactional email** | Resend | one domain, one verified sender |
| **Telegram** | webhook for operator notifications | one bot |
| **Notion sync**, **n8n relays**, **scheduled cron** | publish scheduling, deletion grace purge, blog and comment relays | operational plumbing, one workspace |

### Start with IndexNow

Of that list it is the one worth porting first, and it takes an afternoon.

IndexNow is the protocol Bing and Yandex consume to crawl a changed URL almost
immediately rather than waiting for a scheduled crawl. It needs **no OAuth, no
service account and no secrets** — authentication is "does this key file resolve
on your own domain", so the key is served as a public `.txt` and can be
hardcoded.

Google does not participate. For Google you have GSC's manual *Request
Indexing* or sitemap resubmission, which is why GSC is a separate, heavier
integration.

Implement it fire-and-forget: never throw, so a slow or unreachable endpoint can
never block the publish it is reporting.

### Then GA4 and Search Console together

They share one GCP service account, which is the non-obvious part worth knowing
before you start: access is granted **twice and separately** — GCP IAM for the
project, then the GA4 property's own Access Management, then Search Console's
own Users and Permissions. Three grants, one identity. Missing the second or
third produces a working client that returns empty data, which reads like a bug
in your code.

### WhatsApp, with the warning first

WABA accounts get suspended, sometimes without a clear reason, and a suspended
number can neither receive nor reply. **Never make WhatsApp the only path for
lead capture or verification** — keep email or a form working alongside it.

When you wire it: `WHATSAPP_TOKEN` and `WHATSAPP_VERIFY_TOKEN` are **secrets**
and belong in the environment. The phone-number ID, display number and API
version are configuration and can live in the database. The distinction matters
because anything the site publishes to a browser must never contain a token.

### Analytics needs consent before it needs code

A pixel that fires before the visitor agrees is a problem in several
jurisdictions and an own goal in all of them. The right order is a consent
mechanism, then tags conditional on it, then server-side events if you need
accuracy. That ordering is why analytics is a bigger job than dropping in a
script tag.

## Not started

- **Public contact form** — the table, masking view and admin screen are here;
  the form that writes into one is not. Built upstream.
- **Services catalogue** — no table, and none upstream either
- **Admin authentication** — `/admin/*` is currently open. See
  [BLOCKERS.md](BLOCKERS.md) §3. This is the one that blocks a public deploy.
- **Browser tests** — no Puppeteer or Playwright. The `testing-browser` skill
  describes how; the code is not written.
- **Multi-tenant** — one site per deployment. Several sites means several
  deployments, which is cheap on a VPS but is not a feature here.
- **i18n** — single language.

## Why the honesty

A template that claims integrations it does not ship costs you an afternoon
discovering it, and then you distrust everything else in the README — including
the parts that are true and tested.

So the distinction is kept sharp throughout: **built here** means you can run it
today, **built upstream** means the code exists and has run in production but
you will be porting it, and **not started** means nobody has done it.

The permission model is in the first category, and you can verify it in about
ten minutes with `tests/e2e/mcp.sh`. That single checkable claim is worth more
than a longer feature list you would have to audit line by line.
