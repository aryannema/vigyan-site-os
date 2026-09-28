# Writing skills for your project

A **skill** is a file Claude loads when it becomes relevant. It is how you stop
re-explaining your project's conventions in every conversation, and how you stop
getting a different answer each time.

This repository ships ten in `.claude/skills/`. This is how to write your own.

---

## What a skill is

A directory with a `SKILL.md`:

```
.claude/skills/
  deployment/
    SKILL.md
```

```markdown
---
name: deployment
description: Use when deploying to production, debugging a failed deploy, or
  changing environment variables. Covers the Coolify pipeline and the two
  failures that have actually happened.
---

# Deployment

...
```

Claude reads every `description` and loads the **body** only when one matches
what you are doing. So descriptions cost context on every turn and bodies cost
nothing until needed.

---

## The description decides everything

The body can be perfect and never load. Write the description as **when to use
this**, in the words someone would actually use.

Weak:

```yaml
description: Information about deployment.
```

Strong:

```yaml
description: Use when deploying to production, debugging a failed deploy, or
  changing environment variables. Covers the Coolify pipeline, why NEXT_PUBLIC_
  vars must be set at build time, and the exit-137 out-of-memory build failure.
```

The second names symptoms — *"exit 137"*, *"failed deploy"*. Those are the words
someone types when they have the problem.

Say what a skill does **not** cover, and where to go instead. The `design` skill
here says brand identity belongs to `brand` and that `brand` wins on
disagreement.

---

## Write down what went wrong

The highest-value content is not the happy path — Claude can often infer that. It
is **the thing that surprised you**, which is not inferable from the code.

Real examples from these skills:

> A 1 GB VPS dies during `next build` with an out-of-memory kill that reads as a
> mysterious exit 137.

> `NEXT_PUBLIC_*` are inlined during `next build`. Set them at runtime only and
> they arrive as `undefined` in the browser, with no error.

> SSL/TLS mode Flexible makes Cloudflare talk HTTP to an origin that redirects to
> HTTPS — an infinite loop.

Each cost someone an afternoon. Each is now one line.

---

## Shape

Start with the single most important idea. The `design` skill opens with a "§0.
The one idea" section, because if the reader stops there they still have the
thing that matters most.

Then: the mechanics, then the failure modes as a table.

**Be specific and be current.** Name files, commands and errors. A skill that
says "follow best practice" is worse than nothing, because it consumed context
to say nothing. And a skill describing code that has since changed is worse
still — it is confidently wrong. Delete a stale skill rather than keeping it
around.

---

## Length

| lines | verdict |
|---|---|
| under 50 | probably too thin — is this a skill or a sentence? |
| 100–200 | typical for a good one |
| over 300 | split it, or move reference material into a second file |

The ten shipped here run 93–202 lines.

---

## How these ten fit together

They form a workflow rather than a pile:

```
feature-intake   →  ask the right questions BEFORE any schema is designed
feature-schema   →  evolve tables and capabilities for the new feature
design           →  wire the components
feature-testing  →  drive it in a real browser and find what nobody predicted
seo-optimize     →  before launch
```

With supporting ones alongside: `brand` (identity — authority over `design`),
`database` (migrations and DDL/DML separation), `mcp` (the agent endpoint),
`cloudflare` (DNS and TLS), `site-bootstrap` (standing up a fresh deployment).

`feature-intake` exists because the expensive mistake is not writing the wrong
code — it is building the right code for a misunderstood requirement. It runs
first and asks questions.

---

## Writing one with Claude

Have it draft from what you just did, while the details are fresh:

```
We just spent two hours on the Cloudflare cutover. Write a skill capturing what
we learned — especially the redirect loop and the MX record. Put the failure
modes in a table at the end.
```

Then **check every claim**. A skill is a statement about *your* project;
a plausible-sounding wrong one is worse than no skill, because it will be
believed.

---

## Keeping them honest

- Update the skill in the **same commit** as the change it describes
- Delete skills for features you removed
- If Claude works around a skill instead of following it, the skill is wrong —
  fix the file rather than repeating the correction
- Prefer facts with commands attached: *"verify with `curl -sI ... | grep -i
  location`"* beats *"make sure redirects work"*

---

## A checklist

- [ ] `description` names when to use it, in the words someone would type
- [ ] It says what it does **not** cover
- [ ] The most important idea is first
- [ ] Failure modes are listed, with symptoms
- [ ] Commands are real and were run
- [ ] No secrets, no internal hostnames, no real IPs
- [ ] Under 300 lines
