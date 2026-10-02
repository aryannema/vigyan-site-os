---
name: secrets-ops
description: Handling secrets, keys and credentials for site-os — reading vigyan-secrets.md safely, moving keys into app_secrets, rotating, and responding to an exposure. Use whenever a task touches a key, token, password, .env file, app_secrets, encryption, or the secrets document.
---

# Secrets operations

The canonical record is `vigyan-secrets.md` in Nextcloud
(`admin/files/YourSite/`), **section 0** of which is the registry: which key
is which, who issues it, how to reissue it. Procedures live in
`docs/SECURITY-OPS.md`. Neither is duplicated into this repository.

## Rule 1 — how to read the secrets file

**By heading, or by exact key name. Never a line range.**

```bash
sudo grep -nE '^#{1,4} ' <file>          # headings — safe
sudo grep -n 'RESEND_API_KEY' <file>     # one key by name — safe
sudo sed -n '340,360p' <file>            # NEVER
```

On 2026-09-29 a `sed` range with a length-based redact (`>=20 chars`) echoed
Nextcloud TOTP backup codes — which are 16 characters — into a session
transcript. Length-based filtering does not work. Neither does "I'll be careful."

When you need to know whether two secrets are the same, **fingerprint, never
print**:

```bash
sha256sum <<< "$VALUE" | cut -c1-12      # comparable, reveals nothing
```

## Rule 2 — where a key belongs

> Can the app read it **before** it can reach the database?
> **Yes** → Coolify env. **No** → `app_secrets`.

Boot-critical, never movable: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`CONFIG_ENCRYPTION_KEY`, `ACCOUNT_DELETION_ENCRYPTION_KEY`, `CRON_SECRET`.

`CONFIG_ENCRYPTION_KEY` decrypts `app_secrets`, so it can never live inside it.

Everything else — vendor keys, webhook URLs, R2 — belongs in `app_secrets` and
is changeable without a redeploy.

## Moving keys into app_secrets

Use the script. Do not hand-roll the encryption; the format has to match
`src/lib/app-secrets.ts` byte for byte or the row is silently undecryptable.

```bash
node scripts/seed-app-secrets.mjs --dry-run
node scripts/seed-app-secrets.mjs --only RESEND_API_KEY --dry-run
node scripts/seed-app-secrets.mjs --sql-out /tmp/seed.sql   # then apply, then shred
```

It prints key names and fingerprints only, refuses boot-critical keys, refuses
keys outside the MANAGED list, verifies every round-trip before emitting SQL,
and refuses to print SQL to stdout.

**Always compare `CONFIG_ENCRYPTION_KEY` fingerprints first.** The script prints
its own; compare with production's. A mismatch means rows write successfully and
cannot be decrypted there.

**Verify after applying** by decrypting with production's key, not by trusting
the insert. Format is `base64(iv[12] ‖ authTag[16] ‖ ciphertext)`, optionally
prefixed `v<N>:`. Note Node puts the auth tag in the middle; Python's `AESGCM`
expects it appended — reorder as `body + tag` or you get a spurious `InvalidTag`.

Rollback is `DELETE FROM app_secrets WHERE key = '...'` — `getSecret()` falls
straight back to `process.env`.

## Rotation

Overlap, always: create the new credential, deploy it, verify, *then* revoke the
old one. Never revoke first.

`CONFIG_ENCRYPTION_KEY` is special — add `CONFIG_ENCRYPTION_KEY_V2`, set
`CONFIG_ENCRYPTION_KEY_CURRENT=2`, keep V1 until no v1 rows remain.

## If a value is exposed

1. **Rotate first, investigate second.** Everything is cheap to rotate except
   the age backup private key, which cannot be rotated at all for existing
   backups.
2. Scrub what you can and say plainly what you cannot. Transcripts are at
   `~/.claude/projects/*/*.jsonl`; git history is permanent.
3. Record it in `vigyan-secrets.md` under the affected key, with the date.

Write credentials to production — treat an exposure of these as urgent:
`SUPABASE_SERVICE_ROLE_KEY`, `MCP_SECRET_KEY`, `WEBHOOK_SECRET` (n8n creates
posts through `/api/webhook/blog` with it), the GitHub PAT.

## What this codebase does NOT encrypt

`mask_email()` is a plain SQL string function with **no key**. Masking is access
control — capabilities plus `security_barrier` views — and the underlying value
is **plaintext**. A `pg_dump` sees the real email. That is why backup encryption
is a separate control and why the age keypair exists.

## Never

- Paste a value into a chat, a commit, or a terminal that logs
- Put anything sensitive behind `NEXT_PUBLIC_` — it ships in the browser bundle
- Copy a broad-scoped credential onto a server that only needs a narrow one
- Write key documentation into this repo; it goes in `vigyan-secrets.md`

## Bootstrap values: vault → platform (SOPS + age, 2026-10-02)

`env.manifest.json` names every variable, its **tier** and purpose (no values).
Values live in the encrypted vault `secrets/<env>.sops.env`; the age private key
lives only in `~/.config/sops/age/keys.txt` (never commit, back up offline).

| Tier | Where the value goes |
|---|---|
| `bootstrap` / `public` | Platform env, pushed from the vault (`pnpm secrets sync coolify\|vercel --env prod --apply`) |
| `secret` | Admin → Settings → Secrets (encrypted `app_secrets`); vault copy optional |
| `config` | Admin → Settings (`app_config`) |
| `local` | Operator shell / local scripts only |
| `deprecated` | Remove everywhere |

Rules for agents:
- **Never print, echo or log a value.** The tool prints names, counts and plans only.
- `pnpm secrets check --env prod` before any sync; fix "missing required" and
  "not in manifest" first. `pnpm env:check` fails if code reads a name the
  manifest does not describe.
- Platform syncs are **dry runs** unless `--apply`. Build-time (`phase: build`)
  vars need a redeploy to take effect.
- New variable = add it to `env.manifest.json` in the same change, with a tier.
- Prove a pushed value works **by behaviour** (the integration answers), not by
  reading it back.
- Moving hosts (Coolify → Vercel → AWS) changes only the bootstrap tier, ~7 vars.
