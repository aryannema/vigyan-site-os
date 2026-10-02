#!/usr/bin/env node
/**
 * Brand revision 4 guard. Run with `pnpm brand:check`.
 *
 * 1. tailwind.config.ts's saffron/green scales must equal docs/brand/tokens.css.
 *    Those two scales are the one place brand hex values are repeated, because
 *    Tailwind v3 cannot compute opacity modifiers (bg-saffron-500/10) from a
 *    var() holding a hex. This asserts the copy never drifts from the source.
 * 2. public/brand/*.svg must be byte-identical to docs/brand/web/*.svg.
 * 3. No brand SVG may contain live text (<text> or font-family) — an optimiser
 *    or a hand edit that outlines-to-text would change the logo silently.
 * 4. No retired brand hexes or old logo paths outside docs/brand.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

let failures = 0;
const fail = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const pass = (m) => console.log(`  ok    ${m}`);

// ---- 1. Tailwind scales vs tokens.css ------------------------------------
const tokens = readFileSync('docs/brand/tokens.css', 'utf8');
const tw = readFileSync('tailwind.config.ts', 'utf8');
const scales = [
  ['saffron', ['300', '400', '500', '600', '700']],
  ['green', ['300', '400', '500', '600', '700']],
];
for (const [name, steps] of scales) {
  for (const step of steps) {
    const tokenMatch = tokens.match(new RegExp(`--vb-${name}-${step}\\s*:\\s*(#[0-9a-fA-F]{6})`));
    if (!tokenMatch) continue; // pack doesn't define this step (e.g. green-300/400)
    const want = tokenMatch[1].toLowerCase();
    const block = tw.split(`${name}: {`)[1]?.split('},')[0] ?? '';
    const got = block.match(new RegExp(`${step}:\\s*'(#[0-9a-fA-F]{6})'`))?.[1]?.toLowerCase();
    if (!got) fail(`tailwind.config.ts missing ${name}-${step}`);
    else if (got !== want) fail(`${name}-${step}: tailwind ${got} != tokens.css ${want}`);
  }
}
if (!failures) pass('tailwind brand scales match tokens.css');

// ---- 2 & 3. Brand SVG integrity ------------------------------------------
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const webDir = 'docs/brand/web';
const pubDir = 'public/brand';
let svgProblems = 0;
for (const f of readdirSync(pubDir).filter((f) => f.endsWith('.svg'))) {
  const src = `${webDir}/${f}`;
  if (!existsSync(src)) { fail(`${f} has no counterpart in ${webDir}`); svgProblems++; continue; }
  if (sha(src) !== sha(`${pubDir}/${f}`)) { fail(`${f} differs from ${webDir}`); svgProblems++; }
  const body = readFileSync(`${pubDir}/${f}`, 'utf8');
  if (/<text|font-family/.test(body)) { fail(`${f} contains live text — must be fully outlined`); svgProblems++; }
}
if (!svgProblems) pass('public/brand SVGs byte-identical to docs/brand/web, all outlined');

// ---- 4. Retired values / old logo paths ----------------------------------
const retired = ['#f5a623', '#f5d060', '#1ab8a0', '#0a0e14', '#c84b2f'];
const oldPaths = ['mandala-vi', '/branding/', 'badge-dark'];
const grep = (needle) => {
  try {
    return execSync(
      `grep -rIl -- '${needle}' src public --include='*.tsx' --include='*.ts' --include='*.css' 2>/dev/null || true`,
      { encoding: 'utf8' },
    ).trim();
  } catch { return ''; }
};
for (const needle of [...retired, ...oldPaths]) {
  const hits = grep(needle);
  if (hits) fail(`retired reference '${needle}' still present in:\n        ${hits.split('\n').join('\n        ')}`);
}
if (!failures) pass('no retired hexes or old logo paths outside docs/brand');

console.log(failures ? `\nbrand:check FAILED (${failures})` : '\nbrand:check passed');
process.exit(failures ? 1 : 0);
