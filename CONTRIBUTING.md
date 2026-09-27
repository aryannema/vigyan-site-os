# Contributing

Thanks for looking. This project is early, and the most useful contributions right now are
the unglamorous ones: closing the auth gap, fixing what [BLOCKERS.md](BLOCKERS.md) already
admits is broken, and hardening the database layer.

## Before you start

Read [BLOCKERS.md](BLOCKERS.md). It is an append-only log of known problems, written by
whoever hit them. §3 (no auth layer) is the big one.

If you are planning something substantial, open an issue first. It is a short conversation
that saves a long PR.

## Licence and contributions

This project is [AGPL-3.0](LICENSE), and commercial licences are offered to anyone who needs
to build a closed-source service on top of it.

That second part only works for code the maintainers own. So contributions are accepted under
the **Developer Certificate of Origin** plus a copyright assignment to the maintainers: by
opening a pull request, you confirm you wrote the patch (or have the right to submit it) and
you assign copyright in it to the project maintainers, who license it back to you and to
everyone else under the AGPL.

If that is not acceptable to you, say so in the issue — it is a reasonable position, and it is
better discussed before you write code than after.

Sign off your commits:

```bash
git commit -s -m "your message"
```

## Development

```bash
pnpm install
cp .env.example .env.local     # fill it in — see SETUP.md
psql "$DATABASE_URL" -f supabase/migrations/000_local_auth_stub.sql
# ...apply 001 through 009 in order
pnpm dev
```

Before opening a PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Touching the schema

The permission model is the point of this project, so schema changes get more scrutiny than
anything else.

- **Migrations are append-only.** Add `0NN_your_change.sql`; never edit an applied one.
- **Write the header first.** Every migration in this repo explains *the finding it closes*,
  not just what it does. Read `007_publish_capability_enforcement.sql` for the shape. If you
  cannot articulate what was wrong before, the migration probably is not ready.
- **A capability that only the UI enforces is not enforced.** If a check can be bypassed by
  reaching the table through `psql`, PostgREST, or a screen that forgot, it belongs in a
  policy or a trigger.
- **Prove it.** `tests/permission-matrix.test.ts` and `tests/adversarial-findings.test.ts`
  exist to make a revoked capability actually revoked. A schema PR should add a case that
  fails without your change.

## Reporting a vulnerability

Do not open a public issue. See [SECURITY.md](SECURITY.md).
