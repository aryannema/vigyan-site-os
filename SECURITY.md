# Security

## Known, by design, right now

**`/admin/*` is unauthenticated.** There is no auth layer wired up yet
([BLOCKERS.md](BLOCKERS.md) §3). Anyone who can reach those routes acts as `ADMIN_ACTOR`.

This is not a vulnerability report — it is stated in the README, and it is the single largest
reason this project is marked early. Do not expose an instance to the internet until you have
put authentication in front of it.

Two related consequences worth being explicit about:

- **`MCP_SECRET_KEY` is a password.** The MCP endpoint maps that bearer token to the identity
  in `MCP_SERVICE_ACTOR`, and that identity's role decides what the token can do. Give it the
  narrowest role that works.
- **`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS.** Server-side only. If it reaches a browser,
  every guarantee in the schema is gone.

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), which keeps the report private until
a fix is out.

Please include what you can: affected version or commit, the steps to reproduce it, and what
an attacker gets. A working proof of concept helps but is not required.

Expect a first response within about a week. This is a small project — an honest slow reply is
more likely than a fast one.

## What counts

Interesting, because it breaks a guarantee the project actually makes:

- A capability that can be bypassed — reaching a table through `psql`, PostgREST, or any path
  that skips `user_has_capability()` / `perform_action()` and gets a write the role was not
  granted.
- A write that lands without a matching row in `action_audit_log`. Authorization and audit are
  meant to be one atomic step; a gap between them is a real finding.
- Column-level escapes, such as flipping `status` to published without `blog:publish`.
- PII masking in `005_contact_pii_masking.sql` returning unmasked values to a role that should
  not see them.
- Anything that lets an MCP tool call exceed the role of its backing actor.

Already known, so not a finding:

- Reaching `/admin/*` without credentials (§3 above).
- Anything requiring `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, or `MCP_SECRET_KEY` — those
  are trusted secrets, and holding one is already game over by design.

## Supported versions

Pre-1.0: only `main` is supported. There are no backports yet.
