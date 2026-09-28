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

Adding one is deliberately small: a form, a server action, an insert. The reason
it is not here is that a contact form worth shipping needs a spam defence and a
consent checkbox, and both are decisions a site owner should make rather than
inherit.

### OTP verification — not started

No OTP anywhere: not email, not SMS, not WhatsApp. It is listed because it is
the natural next step for the contact form, and because two dependencies it
would rest on are themselves untested here:

- **Email delivery** — no Resend, SendGrid or SMTP integration exists
- **WhatsApp** — see below

Neither has been tested end to end, so treat any OTP plan as resting on two
untested legs.

### Services — no table, no pages

A services or products catalogue is a common need and is **not modelled**. Blog,
CMS sections, careers and CRM are; services are not. Adding it is the worked
example in `feature-intake` → `feature-schema` if you want to see the workflow
on something real.

## WIP — schema exists, integration does not

These have tables and capabilities in the database, and **no code yet**. The
data model is designed; the wiring is the work.

### WhatsApp Business

`whatsapp_conversations` and `whatsapp_messages` exist, with roles
(`support_bot_text`, `support_bot_voice`, `support_human`) already defined in
`role_capabilities`. A bot and a human can hold different capabilities over the
same conversation — that part is modelled.

Missing: the webhook route, Graph API calls, template management, the
verification handshake.

**One warning from experience, because it is expensive to learn late.** WABA
accounts get suspended, sometimes without a clear reason, and a suspended number
cannot receive or reply. Do not build a lead-capture flow whose only path is
WhatsApp. Keep email or a form working alongside it.

When you implement it: `WHATSAPP_TOKEN` and `WHATSAPP_VERIFY_TOKEN` are
**secrets** and belong in the environment. The phone-number ID, display number
and API version are configuration and can live in the database — the distinction
matters because anything the site publishes to a browser must not contain a
token.

### Analytics — GA4, Meta Pixel, GTM

**None of this is implemented.** No `gtag`, no `fbq`, no GTM container.

It is on the list rather than done because doing it properly means consent
first: a pixel that fires before the visitor agrees is a problem in several
jurisdictions and an own goal in all of them. The right order is a consent
mechanism, then tags conditional on it, then server-side events if you need
accuracy.

### Payments, transactional email

Not implemented, and no tables. Add the provider you actually use.

## Not started

- **Public contact form**, and therefore OTP — see above
- **Services catalogue** — no table
- **Admin authentication** — `/admin/*` is currently open. See
  [BLOCKERS.md](BLOCKERS.md) §3. This is the one that blocks a public deploy.
- **Browser tests** — no Puppeteer or Playwright. The `testing-browser` skill
  describes how; the code is not written.
- **Multi-tenant** — one site per deployment. Several sites means several
  deployments, which is cheap on a VPS but is not a feature here.
- **i18n** — single language.

## Why the honesty

A template that claims integrations it does not have costs you an afternoon
discovering it, and then you distrust everything else in the README — including
the parts that are true and tested.

The permission model here is real and you can verify it in about ten minutes.
That claim is worth more than a longer feature list you would have to check one
by one.
