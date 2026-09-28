#!/usr/bin/env node
/**
 * Mint and inspect JWTs for the MCP endpoint.
 *
 *   pnpm mcp:token --new-secret
 *   export MCP_JWT_SECRET='...'
 *
 *   pnpm mcp:token --issue agent@example.com --days 30
 *   pnpm mcp:token --inspect <token>
 *
 * Why bother when MCP_SECRET_KEY already works: that is one shared secret with
 * no expiry and no identity. Every client that has it is indistinguishable in
 * the audit log, and rotating it cuts off all of them at once. A JWT names its
 * subject, expires on its own, and can be issued per person or per service.
 *
 * The subject must resolve to an `auth.users` row — by uuid or email. The token
 * authenticates only; that row's role in `user_roles` decides every capability.
 */
import { randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = process.env.MCP_JWT_ISSUER ?? 'vigyan-site-os';
const AUDIENCE = process.env.MCP_JWT_AUDIENCE ?? 'vigyan-site-os-mcp';
const ALG = 'HS256';
const ACCESS_MINUTES = Number(process.env.MCP_JWT_ACCESS_MINUTES ?? 15);
const REFRESH_DAYS = Number(process.env.MCP_JWT_REFRESH_DAYS ?? 30);
const TYP_ACCESS = 'access';
const TYP_REFRESH = 'refresh';

async function mint(subject, typ, seconds, scopes) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scopes, typ })
    .setProtectedHeader({ alg: ALG })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + seconds)
    .sign(key());
}

function key() {
  const s = process.env.MCP_JWT_SECRET?.trim();
  if (!s) {
    console.error(
      'MCP_JWT_SECRET is not set.\n' +
        '  Generate one:  pnpm mcp:token --new-secret\n' +
        "  Then:          export MCP_JWT_SECRET='...'",
    );
    process.exit(1);
  }
  if (s.length < 32) {
    console.error(
      `MCP_JWT_SECRET is ${s.length} characters; HS256 needs at least 32.\n` +
        '  Generate one:  pnpm mcp:token --new-secret',
    );
    process.exit(1);
  }
  return new TextEncoder().encode(s);
}

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : (args[i + 1] ?? null);
};

if (args.includes('--new-secret')) {
  console.log(randomBytes(48).toString('base64url'));
  console.error("\n  export MCP_JWT_SECRET='<the line above>'");
  console.error('  Put it in the environment of the running server, never in the repo.');
  console.error('  If it ever leaks, rotate it — deleting the commit does not make it safe.');
  process.exit(0);
}

const scopes = (flag('--scopes') ?? 'mcp').split(/\s+/).filter(Boolean);
const days = Number(flag('--days') ?? REFRESH_DAYS);
const minutes = Number(flag('--minutes') ?? ACCESS_MINUTES);

const issue = flag('--issue');
if (issue) {
  const pair = {
    access_token: await mint(issue, TYP_ACCESS, minutes * 60, scopes),
    refresh_token: await mint(issue, TYP_REFRESH, days * 86400, scopes),
    token_type: 'Bearer',
    expires_in: minutes * 60,
  };
  console.log(JSON.stringify(pair, null, 2));
  console.error(`\n  subject ${issue} · scopes: ${scopes.join(' ')}`);
  console.error(`  access  · ${minutes} min · Authorization: Bearer <access_token>`);
  console.error(`  refresh · ${days} days · POST /api/mcp/refresh with`);
  console.error('            { "refresh_token": "..." }. It cannot call a tool, by design.');
  console.error(`  ${issue} must exist in auth.users and hold a role in user_roles,`);
  console.error('  or every capability check returns false.');
  process.exit(0);
}

const accessOnly = flag('--access-only');
if (accessOnly) {
  console.log(await mint(accessOnly, TYP_ACCESS, minutes * 60, scopes));
  console.error(`\n  access token · ${minutes} min · ${accessOnly}`);
  process.exit(0);
}

const refresh = flag('--refresh');
if (refresh) {
  try {
    const { payload } = await jwtVerify(refresh, key(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
      requiredClaims: ['sub', 'exp', 'iat', 'typ'],
    });
    if (payload.typ !== TYP_REFRESH) {
      console.error(`refresh rejected — that is a '${payload.typ}' token, not a refresh token`);
      process.exit(1);
    }
    const s = Array.isArray(payload.scopes) ? payload.scopes.map(String) : ['mcp'];
    console.log(await mint(String(payload.sub), TYP_ACCESS, minutes * 60, s));
    console.error(`\n  new access token · ${minutes} min · ${payload.sub}`);
  } catch (err) {
    console.error(`refresh rejected — ${err.name}`);
    process.exit(1);
  }
  process.exit(0);
}

const inspect = flag('--inspect');
if (inspect) {
  try {
    const { payload } = await jwtVerify(inspect, key(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
    });
    console.log(JSON.stringify(payload, null, 2));
    const left = Number(payload.exp) - Math.floor(Date.now() / 1000);
    console.error(
      `\n  valid · expires in ${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`,
    );
  } catch (err) {
    console.error(`INVALID: ${err.name}: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

console.error(
  'usage:\n' +
    '  pnpm mcp:token --new-secret\n' +
    '  pnpm mcp:token --issue <uuid|email> [--minutes 15] [--days 30] [--scopes "mcp"]\n' +
    '  pnpm mcp:token --access-only <uuid|email> [--minutes 15]\n' +
    '  pnpm mcp:token --refresh <refresh-token>\n' +
    '  pnpm mcp:token --inspect <token>',
);
process.exit(1);
