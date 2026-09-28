# Before you publish this repository

Anything that reaches a public git history is public **forever**. Deleting a
commit does not help — forks, clones and caches keep it. So the check happens
before the push, not after someone reports it.

Run this from the repository root.

## Automated scan

```bash
# secrets
grep -rInE "(sk-|ghp_|gho_|ghu_|ghs_|ghr_|hf_)[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY" \
  --exclude-dir=node_modules --exclude-dir=.next .

# your own infrastructure
grep -rInE "192\.168\.|10\.[0-9]+\.|100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|\.ts\.net|\.local\b" \
  --exclude-dir=node_modules --exclude-dir=.next .

# real people and real domains
grep -rInE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" \
  --exclude-dir=node_modules --exclude-dir=.next . | grep -v "example.com\|example.org"

# phone numbers
grep -rInE "\+?[0-9]{10,13}" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.sql" \
  --exclude-dir=node_modules .
```

Then the history, which the working tree will not show you:

```bash
git log --all -p | grep -inE "password|secret|token|api[_-]?key" | head -20
```

## What to replace, and with what

| found | replace with |
|---|---|
| A real email | `you@example.com` — **`example.com` is reserved by RFC 2606** and can never be registered |
| A real phone number | `+15551234567`, or `+91 99999 99999` |
| Your domain | `example.com`, or `your-site` |
| A server IP | `<your-server-ip>` |
| A tailnet or LAN address | `<tailnet-ip>`, `<lan-ip>` — these identify real machines |
| A nameserver pair | describe it: *"the two nameservers your dashboard shows"* — pairs are per-account |
| An API key | delete it, then **rotate it** |
| A customer name | a fictional company |

**Do not** use a real-looking domain you do not own. Someone may register it,
and your users' traffic then goes somewhere you do not control.

## Screenshots and images

The most common leak, because nobody greps an image.

Before a screenshot goes in:

- [ ] No real customer names, emails or phone numbers in the data shown
- [ ] No internal hostnames in the **address bar** — this is the usual one
- [ ] No auth tokens in a visible URL or a devtools panel
- [ ] No open browser tabs revealing other systems
- [ ] No notification popups, calendar entries or chat windows caught in frame
- [ ] Redact by **drawing a solid block**, never by blurring

Blurring and pixelation are reversible for short strings. A phone number blurred
at low radius can be recovered; a black rectangle cannot.

Better still: take screenshots against **seeded demo data** rather than
redacting real data. Redaction is something you can forget to do; a demo
database cannot leak what it never held.

## Test fixtures

Everything in tests should be obviously fake:

```ts
'agent@example.com'   // yes
'+15551234567'        // yes
'firstname@gmail.com'  // no — a plausible real address
```

Local test credentials (`e2e-jwt-secret-at-least-thirty-two-chars-long`) are
fine to commit **only** when they are transparently throwaway and never valid
anywhere real. Make that obvious in the name.

## If something already leaked

1. **Rotate it first.** A leaked key stays leaked regardless of what you do to
   git. Rotation is the fix; history rewriting is tidying.
2. Then rewrite history — `git filter-repo`, or `filter-branch` with
   `--index-filter`.
3. Drop `refs/original`, expire the reflog, `gc --prune=now`, force-push.
4. **Tell anyone who cloned it.** Their copy still has it.

Step 1 is the one that matters. Steps 2–4 reduce exposure; they do not undo it.

## What this repository deliberately contains

So you know what is *supposed* to be there:

- `example.com` addresses in tests and documentation
- A worked branding example on a **fictional** company
- Throwaway local test secrets, named so they cannot be mistaken for real ones
- No images at all, currently — which is one fewer thing to check

Scanned before each publish. If you fork this and add screenshots or seed data,
the checklist above becomes yours.
