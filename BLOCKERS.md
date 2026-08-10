# BLOCKERS

Append-only. Add a new `##` section; do not edit or remove other agents' notes.

## 1. `pnpm install` fails — `eslint-config-next` transitive dep does not exist on npm

> **UPDATE (admin-UI agent, later the same day): APPEARS TRANSIENT — see #8.**
> A later `pnpm install` resolved the same tree fine, so this was most likely a
> registry-side propagation gap rather than a genuinely bad manifest. Left here
> because the failure mode and the override recipe are worth keeping if it recurs.
> The `packageManager` field pins pnpm, so prefer pnpm over the npm workaround below.

*Reported by: admin-UI agent (Phase 2), 2026-08-10. Affects: every agent / anyone
cloning the repo.*

`pnpm install` from a clean checkout fails:

```
ERR_PNPM_NO_MATCHING_VERSION  No matching version found for
@typescript-eslint/scope-manager@8.67.0
  This error happened while installing the dependencies of eslint-config-next@15.5.23
  at @typescript-eslint/parser@8.67.0
```

Confirmed genuine (not a stale cache): `npm view @typescript-eslint/scope-manager@8.67.0`
returns 404, and the package's `latest` dist-tag is `8.66.0`. `eslint-config-next@15.5.23`
(what `^15.1.0` resolves to today) pins `@typescript-eslint/*@8.67.0`, a version that was
never published / was unpublished.

**Impact:** no `node_modules`, so nothing builds, until this is resolved.

**Fix (needs a `package.json` edit — outside the admin agent's scope):** either
pin the devDependency, e.g. `"eslint-config-next": "15.1.0"`, or add an override:

```json
"pnpm": { "overrides": { "@typescript-eslint/scope-manager": "8.66.0",
                         "@typescript-eslint/parser": "8.66.0",
                         "@typescript-eslint/eslint-plugin": "8.66.0",
                         "@typescript-eslint/type-utils": "8.66.0",
                         "@typescript-eslint/utils": "8.66.0",
                         "@typescript-eslint/typescript-estree": "8.66.0",
                         "@typescript-eslint/visitor-keys": "8.66.0" } }
```

**Workaround used in the meantime (no repo files changed):** installed with npm,
omitting dev deps and then adding the build-critical dev tooling explicitly:

```sh
npm install --no-save --omit=dev
npm install --no-save --omit=dev typescript @types/node @types/react \
  @types/react-dom @types/pg tailwindcss postcss autoprefixer
```

`next build` and `tsc --noEmit` both work under that tree; only `next lint` is
unavailable. This is a local `node_modules` workaround only — the real fix still
needs the `package.json` change above.

## 2. `tsconfig.json` path alias `@/*` points at a non-existent `./src/*`

> **UPDATE (admin-UI agent, later the same day): RESOLVED.** `tsconfig.json` now maps
> `"@/*": ["./*"]`, so `@/lib/utils`, `@/components/ui/*` and `@/types/schema` all
> resolve. No action needed. Code under `app/admin/` still uses relative imports —
> written before the fix, and correct either way — so nothing needs migrating.

*Reported by: admin-UI agent (Phase 2), 2026-08-10. Affects: every agent using
`@/` imports, and all shadcn-generated components.*

`tsconfig.json` maps `"@/*": ["./src/*"]`, but this repo has no `src/` directory —
code lives at `app/`, `components/`, `lib/`, `types/`. Meanwhile `components.json`
declares the shadcn aliases `@/components`, `@/lib/utils`, `@/components/ui`, and
every file the shadcn CLI generates imports `@/lib/utils`. Those imports cannot
resolve, so anything importing a shadcn primitive fails to compile.

(Only `"@/types/*": ["./types/*"]` works today, because it is mapped explicitly.)

**Fix (needs a `tsconfig.json` edit — outside the admin agent's scope):** change the
mapping to the repo's actual layout, keeping the existing `@/types/*` entry working:

```json
"paths": { "@/*": ["./*"] }
```

(`./*` subsumes `@/types/*`, so that entry can then be dropped or left as-is.)

**Workaround used in the meantime:** everything under `app/admin/` uses relative
imports (`../../components/ui/button`), and the shadcn-generated files in
`components/ui/` had their `@/lib/utils` imports rewritten to `../../lib/utils`.
Relative imports keep working unchanged after the tsconfig fix lands, so no cleanup
is required — but new code written by other agents should assume `@/` is broken
until it is fixed.

## 3. No auth layer — `/admin/*` is currently unauthenticated

*Reported by: admin-UI agent (Phase 2), 2026-08-10.*

Per the Phase 2 brief there is no GoTrue/auth backend wired up yet, so the admin UI
was built with **no auth gating at all** — no middleware, no login redirect, no fake
session stub. `/admin/*` is fully open to anyone who can reach the server.

The admin Server Actions connect as the `DATABASE_URL` role (owner/service-role
equivalent), which **bypasses RLS**. That is required today — the capability matrix
has no authenticated write policy by design (003 §8.11) — but it means the database
is not providing a second line of defence for these routes. The RLS policies in
003/005 are still correct and still govern browser-side/PostgREST access; they just
are not what is protecting `/admin`.

**What the future auth layer needs to do** (documented in
`app/admin/layout.tsx` and `app/admin/lib/db.ts`):

1. Add a `middleware.ts` matching `/admin/:path*` that resolves the session and
   redirects unauthenticated users to the login route.
2. Replace `resolveActor()` in `app/admin/lib/db.ts` with the session user's id.
   That is a one-function change and nothing else needs touching: every admin write
   already funnels through `mutate()`, and every capability-sensitive read through
   `queryAsActor()`.
3. Gate the capability grid itself on `users:edit`.

### `ADMIN_ACTOR` — needed in `.env.local` (outside the admin agent's scope)

The admin UI already supports acting as a real identity, using the same
convention as the MCP route (#4):

```
ADMIN_ACTOR=<uuid or email of an auth.users row>
```

When it is set, `app/admin/lib/db.ts` opens each transaction with
`set_config('request.jwt.claims', …, true)` and routes every write through
`public.perform_action()` — a genuine capability check plus an audit row,
atomically. Verified end-to-end against the seeded identities from #6:

- as `admin`: capability toggles succeed and `action_audit_log.actor` is the real
  uuid; `/admin/crm` shows raw email/phone.
- as `viewer`: the same toggle is refused with
  `perform_action: … is not permitted to edit on users`, **and the data change
  rolls back with it** (the row was verified unchanged afterwards); `/admin/crm`
  shows `s***@example.test` / `+91 XXXXX XXX10` and renders no `mailto:`/`tel:` links.

With `ADMIN_ACTOR` unset every page still works: writes record an audit row
attributed to `system:admin-ui` with **no capability check**, which is the only
honest behaviour available with no identity to check against. So this is a
hardening step, not a prerequisite.

## 4. `.env.local` needs `MCP_SERVICE_ACTOR` for the MCP route's writes to work

*Reported by: MCP agent (Phase 2), 2026-08-10. Affects: anyone calling `/api/mcp`.*

`app/api/mcp/route.ts` authenticates service callers with
`Authorization: Bearer ${MCP_SECRET_KEY}` and records them as the identity
`mcp-service-token`. That token cannot be an *actor*, though: `perform_action()`
resolves `p_actor` only as a uuid or an `auth.users` email
(004 §2, `TODO(phase-1.5-or-later)` — `service_tokens(token_name, role)` does not
exist yet), and `user_has_capability()` takes a `uuid`. A bare token string
therefore fails with *"actor could not be resolved to a known identity"*.

So the route maps the token onto a configured backing identity:

```
MCP_SERVICE_ACTOR=<uuid or email of an auth.users row>
```

The token authenticates; that identity's role in `user_roles` authorizes. Nothing
is hardcoded and the token confers no privilege of its own — point it at an
`admin` identity for full automation access, or a narrower role to scope it.

**Needed (outside the MCP agent's scope — the brief says not to touch `.env.local`):**
add that line. Until it is set, `tools/list` still works but every `tools/call`
returns a clear JSON-RPC error (`-32004`) naming the missing variable rather than
failing obscurely. Setting it to something that does not exist in `auth.users`
returns `-32003`.

This whole indirection disappears when GoTrue lands: a session identity *is* an
actor, and `resolveCallerIdentity()` has a `TODO(auth-phase)` marking exactly where
that branch goes.

## 5. Reading `contact_inquiries_view` from server-side `pg` needs `request.jwt.claims` set

*Reported by: MCP agent (Phase 2), 2026-08-10. Affects: any server-side code
reading contact inquiries (admin UI CRM screens in particular).*

`public.contact_inquiries_view` is **not** `security_invoker`, and both its row gate
and its PII masking are decided from `auth.uid()` (005 §3). A direct `pg` connection
has no JWT, so `auth.uid()` is NULL and **the view returns zero rows** — which reads
like "no inquiries yet" rather than like a permission problem. The tempting fix
(query `contact_inquiries` directly, which works because `DATABASE_URL`'s role owns
the table and bypasses RLS) is exactly the bypass 005 §4 closes: it returns raw PII
regardless of the acting user's capabilities.

The correct pattern, used in `app/api/mcp/route.ts` (`withActorTransaction`):

```ts
await client.query('begin');
await client.query('select set_config($1, $2, true)', [       // true = transaction-local
  'request.jwt.claims',
  JSON.stringify({ sub: actorUserId, role: 'authenticated' }),
]);
// ...view reads here see auth.uid() = actorUserId and mask per that user's capabilities
await client.query('commit');
```

Transaction-local (`is_local = true`) matters: a session-level `set_config` would
leak the impersonated identity onto the next borrower of that pooled connection.

Bonus: with `auth.uid()` set to the same identity passed as `p_actor`,
`perform_action()`'s anti-impersonation check is satisfied by construction rather
than relying on the NULL-`auth.uid()` trusted-backend branch.

## 6. Local dev identities seeded into the database (FYI, not a blocker)

*Reported by: MCP agent (Phase 2), 2026-08-10.*

The database had no `auth.users` / `user_roles` rows at all, so nothing that goes
through the capability system could be exercised. Two local test identities were
inserted directly (no migration was added — that is out of this agent's scope):

| uuid | email | role |
|---|---|---|
| `11111111-1111-4111-8111-111111111111` | `mcp-service@example.test` | `admin` |
| `22222222-2222-4222-8222-222222222222` | `crm-viewer@example.test`  | `viewer` |

Plus two sample `contact_inquiries` rows with PII, used to verify that
`contact_inquiries_view` masks correctly (admin sees raw, viewer sees
`s***@example.test` / `+91 XXXXX XXX10`). Useful for anyone else who needs a
capability-holding identity locally. If these should be reproducible, they belong in
a `supabase/seed.sql` — someone who owns that directory should decide.

## 7. `pnpm test` is red because of `lib/content/content.test.tsx` (JSX transform), not the DB suite

*Reported by: permission-test agent (Phase 2), 2026-08-10. Affects: anyone running
`pnpm test` / CI.*

`tests/permission-matrix.test.ts`, `tests/perform-action.test.ts` and
`tests/pii-masking.test.ts` all pass (241 tests). The suite still exits non-zero
because a fourth file fails to even collect:

```
FAIL  lib/content/content.test.tsx [ lib/content/content.test.tsx ]
ReferenceError: React is not defined
 ❯ render lib/content/content.test.tsx:40:5
```

**Cause:** there is no ROOT `vitest.config.ts`, so bare `vitest run` (which is what
`"test"` in `package.json` is) falls back to esbuild's default JSX handling, and
`tsconfig.json` sets `"jsx": "preserve"` — neither selects the automatic runtime, so
JSX compiles to bare `React.createElement(...)` while the test file never imports
React. The content-module agent did ship `lib/content/vitest.config.ts` with
`esbuild: { jsx: 'automatic' }`, and that file passes when run explicitly:

```sh
pnpm vitest run --config lib/content/vitest.config.ts   # green
pnpm vitest run tests/                                  # green (241 tests)
pnpm test                                               # red — picks up both, no root config
```

So nothing is actually broken; the two suites just have no single entry point.

**Fix (needs a file outside `tests/` — out of this agent's scope), pick one:**

1. Add a root `vitest.config.ts` with `esbuild: { jsx: 'automatic' }`. One config
   covers both suites and `pnpm test` goes green as-is. Simplest.
2. Or make `"test"` a Vitest **workspace** (`vitest.workspace.ts` listing the root DB
   project and `lib/content/vitest.config.ts`), which keeps the per-module settings
   separate — this is what the existing scoped config seems to anticipate.
3. Or set `"jsx": "react-jsx"` in `tsconfig.json` (Next.js supports it) so no Vitest
   config is needed at all for the JSX half.

Whichever is chosen, a root config is worth having regardless: `include`, `environment`
and `pool` are all defaults today, so the DB integration tests share a worker pool with
the component tests.

## 8. `node_modules` disappeared mid-session (concurrent installs)

*Reported by: permission-test agent (Phase 2), 2026-08-10.*

Blocker #1's `pnpm install` failure did NOT reproduce today: a clean
`pnpm install --lockfile=false --ignore-scripts` resolved `eslint-config-next@15.5.23`
and installed fine, so the unpublished-`@typescript-eslint/*@8.67.0` problem appears to
have been transient/registry-side. `tsc --noEmit` is clean on the resulting tree.

Worth knowing: `node_modules/` was wiped out from under a running task partway through
(two agents installing with different package managers — `npm --no-save` per blocker #1
vs `pnpm`). If tests suddenly fail with `ERR_MODULE_NOT_FOUND: Cannot find package 'pg'`,
that is what happened; re-run the install. The lockfile is still not committed, so the
repo has no reproducible dependency state — that is the real fix and it needs a
`package.json`/`pnpm-lock.yaml` decision from whoever owns them.

## 9. Notes on the DB test suite for whoever touches the schema next

*Reported by: permission-test agent (Phase 2), 2026-08-10. Not a blocker — read before
editing 000/003/004/005.*

- The suite is an INTEGRATION suite: it connects to the real `DATABASE_URL` and needs a
  migrated `vigyan_site_os` to run at all. There is no mock/offline mode by design —
  RLS, `SECURITY DEFINER` and view ownership are the things under test.
- Expected permissions are read from `role_capabilities` at run time, never hardcoded, so
  changing a grant does not break the tests. Changing the *mechanism* does.
- Isolation is one `BEGIN` per test file, never committed, plus a `SAVEPOINT` per test.
  `auth.local_login()` uses `set_config(..., is_local => false)`, so the JWT-claims GUC
  does NOT unwind on `ROLLBACK`; teardown calls `auth.local_logout()` explicitly. Anything
  else that impersonates a user in SQL needs to do the same.
- `auth.local_login()` is owner-only, so it must be called BEFORE `SET LOCAL ROLE
  authenticated`, not after.
- `DATABASE_URL` connects as `vigyan_site_os`, which owns every table and therefore
  BYPASSES RLS (003 §7 deliberately omits `FORCE ROW LEVEL SECURITY`). Any test or script
  that means to exercise a policy must `SET LOCAL ROLE authenticated` first — otherwise it
  passes vacuously.

## 4. `pnpm install` DOES work today with `--lockfile=false` (re: §1)

*Reported by: content-format agent (`lib/content/`), 2026-08-10.*

Re-tested §1 at 22:55 and it did not reproduce — a plain resolve of the current
`package.json` succeeded:

```sh
pnpm install --lockfile=false      # resolved 659, added 561, done in 22.5s
```

So `@typescript-eslint/scope-manager@8.67.0` is resolvable now; §1 was most likely
a transient registry/publish state rather than a permanently missing version. The
override block in §1 may therefore be unnecessary — please re-check before editing
`package.json`.

Two notes on that command:

- `--lockfile=false` was used deliberately so no `pnpm-lock.yaml` (a tracked file,
  outside this agent's scope) was created. **Whoever owns `package.json` should run
  a normal `pnpm install` and commit the lockfile** — four agents installing into
  one un-lockfiled `node_modules` is why it kept disappearing mid-run.
- pnpm skipped the build scripts for `esbuild`, `sharp` and `unrs-resolver`
  (`pnpm approve-builds`). Vitest ran fine regardless.

## 5. `tsconfig.json` `@/*` — corroborating §2 from `lib/content/`

*Reported by: content-format agent, 2026-08-10.*

Independently hit the same thing. `lib/content/` works around it the same way the
admin UI did:

- intra-directory imports are relative (`./blocks`, `./FormattedText`);
- the base types come from `@/types/schema`, which is the one alias that resolves.

Nothing in `lib/content/` needs changing once §2 is fixed. Note for whoever fixes
it: `"@/*": ["./*"]` is safe to add alongside the existing `"@/types/*"` entry —
TypeScript prefers the longer prefix, so the explicit `@/types/*` mapping keeps
winning.

Consumers of this module (`app/blog/**`, the admin editor, MCP tool handlers)
should import `../../lib/content/renderer` style until then; `lib/content/FORMAT.md`
§7 documents this.

## 6. `@tiptap/extension-image` is missing (blocks the WYSIWYG image node)

*Reported by: content-format agent, 2026-08-10. Not blocking anything today.*

`package.json` has `@tiptap/react`, `@tiptap/starter-kit` and
`@tiptap/extension-link`. StarterKit has **no image node**, so the `image` block
in `lib/content/blocks.ts` has no editor-side counterpart — the serialisation
contract in `lib/content/tiptap.ts` emits/reads a ProseMirror `image` node, and
whoever builds the editor will need:

```sh
pnpm add @tiptap/extension-image
```

Two more things that editor will need, documented in `lib/content/tiptap.ts` but
repeated here because they are configuration, not code:

1. StarterKit must be configured with every mark outside
   `EXPECTED_TIPTAP_MARKS` (`bold`, `italic`, `code`, `link`) **disabled** — in
   particular `strike`. A mark this format cannot store silently vanishes on save.
2. `image` needs a `title` attribute and `codeBlock` a `filename` attribute
   declared on the node, or ProseMirror drops the block's `caption` / `filename`.

## 7. FYI — `lib/content/` has its own vitest config (not a blocker)

*Reported by: content-format agent, 2026-08-10. For whoever owns `tests/`.*

`lib/content/vitest.config.ts` exists because this module's tests are `.tsx` and
Vitest needs `esbuild: { jsx: 'automatic' }`, while the root `tsconfig.json`
correctly sets `"jsx": "preserve"` for Next.js. Run them with:

```sh
pnpm vitest run --config lib/content/vitest.config.ts
```

If the root suite later grows a config with the same `esbuild.jsx` setting, this
one can be deleted and `lib/content/**/*.test.tsx` folded into the root `include`.
The `test` script in `package.json` (`vitest run`) does **not** currently pick
these up.

## 8. §5 and §7 are now resolved (content-format agent, follow-up)

*2026-08-10, after the tsconfig and root-vitest changes landed mid-session.*

- **§2 / §5 (path alias):** fixed — `tsconfig.json` now maps `"@/*": ["./*"]`.
  `lib/content/` typechecks clean against the real root config, and
  `@/lib/content/...` imports work. `lib/content/FORMAT.md` no longer carries the
  relative-import caveat.
- **§7 (scoped vitest config):** withdrawn. The root `vitest.config.ts` that
  appeared has `esbuild.jsx = 'automatic'`, which is all this module needed, so
  `lib/content/vitest.config.ts` was **deleted**. `pnpm test` and
  `pnpm vitest run lib/content` both pick up the 62 tests here.

§4 (lockfile) and §6 (`@tiptap/extension-image`) still stand.

## 10. `next build` silently reverts `tsconfig.json`'s `jsx` setting (affects §7, first series)

*Reported by: admin-UI agent (Phase 2), 2026-08-10.*

Next.js rewrites `tsconfig.json` on every build, and one of its "mandatory changes"
is `jsx: "preserve"`:

```
We detected TypeScript in your project and reconfigured your tsconfig.json file for you.
The following mandatory changes were made to your tsconfig.json:
	- jsx was set to preserve (next.js implements its own optimized jsx transform)
```

That matters for the JSX-transform blocker: **setting `"jsx": "react-jsx"` in
`tsconfig.json` is not a durable fix** — it survives until the next `next build`, then
silently reverts and takes `pnpm test` red again with no obvious cause. Prefer a root
`vitest.config.ts` with `esbuild: { jsx: 'automatic' }`, or a Vitest workspace; both
are independent of what Next does to `tsconfig.json`.

(Observed live: `tsconfig.json` read `"jsx": "react-jsx"` before a `next build` in this
session and `"jsx": "preserve"` after it.)

**No action needed right now** — a root `vitest.config.ts` with
`esbuild: { jsx: 'automatic' }` is already committed, which is the durable fix, and
`pnpm vitest run` is green (303 tests, 5 files) with `jsx` back at `"preserve"`. This
note exists so nobody "fixes" it again by editing `tsconfig.json` and then loses the
change to the next build without noticing.

## 11. Numbering in this file has collided — two parallel §4–§8 series exist

*Reported by: admin-UI agent (Phase 2), 2026-08-10. Housekeeping, not a blocker.*

Several agents appended concurrently and picked overlapping numbers, so there are now
two sections numbered 4, 5, 6, 7 and 8. Cross-references like "see §5" are ambiguous.
Nothing is lost — every section is intact — but whoever consolidates this file next
should renumber, and cross-references should be checked rather than trusted. Later
sections were appended with higher numbers (10, 11) to avoid extending the collision.
