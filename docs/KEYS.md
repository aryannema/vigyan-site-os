# Keys and secrets

**Not documented here.** The canonical record is `vigyan-secrets.md` in
Nextcloud (`admin/files/YourSite/`), section **0. KEY REGISTRY** at the top.

It covers, for every key: who issues it, the exact command or screen to reissue
it, whether it is symmetric / asymmetric / one-way, what breaks without it, and
which of the four places it belongs in — `.env.local`, Coolify, the
`app_secrets` table, or nowhere near the app.

Nothing about keys is duplicated into this repository. Two copies drift, and
when they drift nobody can tell which one is lying.

`docs/VIGYAN_SECRETS.md` in this repo is the older, partly-overlapping copy and
is pending a prune — see `TODO-2026-09-29-SECRETS-DOC-AUDIT`.
