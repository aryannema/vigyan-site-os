# secrets/

Encrypted vaults (`<env>.sops.env`, SOPS + age). Values are ciphertext; names and
the `.sops.yaml` recipients are public. Plaintext files are git-ignored here.

```
pnpm secrets init                          # once per machine: age key + recipient
pnpm secrets import --env prod --from f    # encrypt an existing dotenv, then delete f
pnpm secrets edit   --env prod             # change values ($EDITOR, re-encrypted on save)
pnpm secrets check  --env prod             # vault vs env.manifest.json (names only)
pnpm secrets sync local   --env dev        # write .env.local (600)
pnpm secrets sync coolify --env prod       # plan; add --apply to push (COOLIFY_* in your shell)
pnpm secrets sync vercel  --env prod       # plan; add --apply to push (VERCEL_* in your shell)
```

Platforms get only `bootstrap` + `public` tiers; everything else is set in the
admin panel. Back up `~/.config/sops/age/keys.txt` offline: losing it loses the vault.
A second machine: run `pnpm secrets init` there, add its public key to `.sops.yaml`,
then `sops updatekeys secrets/<env>.sops.env` from a machine that can decrypt.
