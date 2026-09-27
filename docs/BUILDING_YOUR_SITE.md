# Building your site

From a clone to a working site. What this template gives you, what it does not, and the order
that avoids rework.

---

## What you get, honestly

**A content store and an admin console.** Blog posts, editable page sections, job openings, and
contact enquiries — all with a permission system enforced in the database rather than in the UI.

**Almost no public site.** Three public routes exist: `/`, `/login`, `/pending-approval`. The
marketing pages are yours to build.

That split is deliberate. The hard, boring, security-critical half — roles, capabilities, audit
trails, PII masking — is done and tested. The half that has to look like *your* company is not,
because a template that ships opinionated marketing pages is a template you spend a week
deleting.

---

## Order of work

```
1. database up, migrations applied      30 min
2. admin reachable, a user with a role  20 min
3. put your real content in             an afternoon
4. build the public pages               the actual work
5. read A_SITE_THAT_SELLS.md            before writing any copy
```

Step 5 is placed there on purpose. Writing the pages first and the message second means writing
them twice.

---

## 1. Database

```bash
pnpm install
createdb my_site
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -d my_site -f "$f"
done
```

`ON_ERROR_STOP=1` matters. Without it a failed migration is skipped silently and you end up on a
half-applied schema that behaves strangely much later.

```bash
cp .env.example .env.local     # fill in DATABASE_URL, ADMIN_ACTOR
pnpm dev
```

---

## 2. Give yourself a role

Nothing works until an identity has capabilities. Roles are `admin`, `editor`, `support_human`,
`viewer`.

```sql
INSERT INTO auth.users (id, email)
VALUES (gen_random_uuid(), 'you@yourdomain.com')
RETURNING id;

INSERT INTO public.user_roles (user_id, role) VALUES ('<that-uuid>', 'admin');
```

Put that uuid in `ADMIN_ACTOR` in `.env.local`.

> **`/admin/*` has no authentication yet** — see `BLOCKERS.md` §3. Anyone who reaches those
> routes *is* `ADMIN_ACTOR`. Keep it on localhost until you have added auth.

---

## 3. Your content

| Table | Admin screen | Holds |
|---|---|---|
| `site_content` | `/admin/cms` | editable page sections — hero, about, whatever you define |
| `posts` | `/admin/blog` | articles, with draft and published states |
| `job_openings` | `/admin/careers` | roles you are hiring for |
| `contact_inquiries` | `/admin/crm` | form submissions, with PII masking by capability |

**Use the admin screens, not SQL.** Every write through the UI goes via `perform_action()`,
which authorises and audits in one step. A direct `INSERT` skips both, and you lose the audit
trail that makes the permission model worth having.

---

## 4. The public pages

This is where you actually build. Read from the content store rather than hardcoding:

```tsx
// app/(marketing)/page.tsx
const hero = await getSection('hero');        // editable at /admin/cms
const posts = await getPublishedPosts(3);     // only status='published'
```

Two rules that save pain later:

**Filter by status.** A blog list that forgets `status = 'published'` shows drafts to the
public. It is the single most common mistake with this schema.

**Let the owner edit copy.** Anything hardcoded in JSX is a code deploy every time the wording
changes. Anything in `site_content` is a text box in the admin.

---

## 5. Permissions

Four roles ship configured. Before you invent more, check whether the ones you have fit — a role
per person does not scale, a role per *job* does.

```sql
-- what can an editor do?
SELECT resource_key, action, allowed
FROM public.role_capabilities
WHERE role = 'editor'
ORDER BY resource_key, action;
```

**`view` is a floor.** Since migration 010, an acting capability requires the view it depends
on. Granting `edit` without `view` grants nothing — that is deliberate, and it closed a real
vulnerability where a role denied `crm:view` could still read raw customer PII through
`crm:create`.

---

## 6. Before you go live

```bash
pnpm typecheck
pnpm test          # 313 tests — needs Postgres and DATABASE_URL
pnpm build
```

And the things no test catches:

- **Add authentication to `/admin/*`.** Non-negotiable.
- Check the blog list does not show drafts.
- Submit your own contact form and confirm it lands in `/admin/crm`.
- Open the site on a phone.

---

## Adding a table of your own

1. `supabase/migrations/0NN_your_thing.sql` — **never edit an applied migration**, it already
   ran and the edit changes nothing on any existing database
2. `ENABLE ROW LEVEL SECURITY` **and write a policy in the same file** — RLS without a policy
   denies everything and Postgres does not warn you; every query silently returns zero rows
3. Add the resource key to `RESOURCE_KEYS` in `types/schema.ts`, or the admin permission grid
   has no row for it
4. Seed capability grants for every existing role, including the ones that should get nothing —
   an absent row and an explicit `allowed = false` read differently to whoever is looking at the
   grid
5. Route writes through `perform_action()`

Then regenerate the map:

```bash
node scripts/migration-map.mjs        # updates docs/MIGRATIONS.md
```

---

## Where things live

| | |
|---|---|
| `docs/MIGRATIONS.md` | every migration, table, view and policy — generated, do not hand-edit |
| `docs/A_SITE_THAT_SELLS.md` | what to put on the pages once they render |
| `BLOCKERS.md` | known problems, append-only, read §3 first |
| `SETUP.md` | credentials and where they go |
