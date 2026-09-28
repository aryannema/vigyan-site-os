/**
 * Authentication for the MCP endpoint.
 *
 * Two credentials are accepted, and they are not equivalent:
 *
 *   Bearer <MCP_SECRET_KEY>   one shared secret, one identity, no expiry.
 *                             Fine for a single trusted service you control.
 *                             Rotating it invalidates every client at once, and
 *                             it cannot say WHICH client called.
 *
 *   Bearer <JWT>              signed, per-subject, expiring, scoped. Several
 *                             clients, each identifiable in the audit log, each
 *                             revocable by letting its token lapse.
 *
 * The JWT is an AUTHENTICATOR, not an authorization. Its `sub` resolves to an
 * `auth.users` row, and that row's role in `user_roles` decides every capability
 * check. A token cannot grant a capability the database has not granted — which
 * is the entire reason authorization lives in Postgres here.
 *
 * HS256 by default: one secret, shared between whoever mints tokens and this
 * server. Use RS256 when tokens must be minted somewhere you would not trust
 * with a signing key — the server then needs only the public half.
 */
import { jwtVerify, SignJWT } from 'jose';

export const JWT_ISSUER = process.env.MCP_JWT_ISSUER ?? 'vigyan-site-os';
export const JWT_AUDIENCE = process.env.MCP_JWT_AUDIENCE ?? 'vigyan-site-os-mcp';
const ALG = 'HS256';

/** Scope required to reach the MCP endpoint at all. Capabilities are separate. */
export const MCP_SCOPE = 'mcp';

/**
 * Two token types, and they must never be interchangeable.
 *
 *   access   short-lived; the only kind that may call a tool
 *   refresh  long-lived; carries nothing but the right to mint a new access
 *            token — it cannot call a tool
 *
 * Why: a long-lived access token that leaks is usable until it expires, and you
 * cannot tell that it leaked. A short one limits that window to minutes, and
 * the refresh token is sent only when refreshing rather than on every call, so
 * it spends far less time in transit and in logs.
 *
 * The classic bug is TYPE CONFUSION — if the two differ only by scope, a caller
 * can present a refresh token where an access token is expected and the
 * verifier, seeing a valid signature, accepts it. So the type is an explicit
 * `typ` claim, checked on every path.
 */
export const TYP_ACCESS = 'access';
export const TYP_REFRESH = 'refresh';

export const ACCESS_MINUTES = Number(process.env.MCP_JWT_ACCESS_MINUTES ?? 15);
export const REFRESH_DAYS = Number(process.env.MCP_JWT_REFRESH_DAYS ?? 30);

export interface VerifiedToken {
  /** The `sub` claim — an auth.users uuid, or an email that resolves to one. */
  subject: string;
  scopes: string[];
  expiresAt: number;
}

function secretKey(): Uint8Array | null {
  const s = process.env.MCP_JWT_SECRET?.trim();
  if (!s) return null;
  // HS256 with a short secret is brute-forceable offline once an attacker holds
  // any token signed by it. Refuse rather than accept a weak key.
  if (s.length < 32) {
    console.error('MCP_JWT_SECRET is shorter than 32 characters; JWT auth is disabled.');
    return null;
  }
  return new TextEncoder().encode(s);
}

/** Is JWT auth configured at all? Decides which error message the caller sees. */
export function jwtEnabled(): boolean {
  return secretKey() !== null;
}

/**
 * Verify a bearer token.
 *
 * Returns null for every failure. The REASON is logged server-side and never
 * returned to the caller: "expired" versus "bad signature" versus "wrong
 * audience" helps an attacker enumerate and helps a legitimate client not at
 * all — their token either works or needs reissuing.
 */
export async function verifyMcpJwt(token: string): Promise<VerifiedToken | null> {
  const key = secretKey();
  if (!key) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [ALG],
      // `jose` rejects an expired token on its own; requiring the claim to
      // EXIST stops a token with no `exp` being treated as eternal.
      requiredClaims: ['sub', 'exp', 'iat', 'typ'],
    });

    // A refresh token is not an access token. Without this a caller could
    // present their long-lived refresh token to call tools, defeating the whole
    // point of a short access lifetime.
    if (payload.typ !== TYP_ACCESS) {
      console.warn(`mcp-auth: rejected '${String(payload.typ)}' token where access was required`);
      return null;
    }

    const raw = payload.scopes;
    const scopes = Array.isArray(raw)
      ? raw.map(String)
      : typeof raw === 'string'
        ? raw.split(/\s+/).filter(Boolean)
        : [];

    if (!scopes.includes(MCP_SCOPE)) {
      console.warn(`mcp-auth: token for ${String(payload.sub)} lacks the '${MCP_SCOPE}' scope`);
      return null;
    }

    return {
      subject: String(payload.sub),
      scopes,
      expiresAt: Number(payload.exp),
    };
  } catch (err) {
    console.warn(`mcp-auth: token rejected (${(err as Error).name})`);
    return null;
  }
}

/**
 * Mint a token. Kept beside the verifier so the claim set and the checks cannot
 * drift apart.
 */
async function sign(
  subject: string,
  typ: string,
  seconds: number,
  scopes: string[],
): Promise<string> {
  const key = secretKey();
  if (!key) {
    throw new Error(
      'MCP_JWT_SECRET is not set, or is shorter than 32 characters.\n' +
        '  Generate one:  pnpm mcp:token --new-secret',
    );
  }
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scopes, typ })
    .setProtectedHeader({ alg: ALG })
    .setSubject(subject)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + seconds)
    .sign(key);
}

export function signAccessToken(subject: string, scopes: string[] = [MCP_SCOPE]) {
  return sign(subject, TYP_ACCESS, ACCESS_MINUTES * 60, scopes);
}

export function signRefreshToken(subject: string, scopes: string[] = [MCP_SCOPE]) {
  return sign(subject, TYP_REFRESH, REFRESH_DAYS * 86400, scopes);
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export async function signTokenPair(
  subject: string,
  scopes: string[] = [MCP_SCOPE],
): Promise<TokenPair> {
  return {
    access_token: await signAccessToken(subject, scopes),
    refresh_token: await signRefreshToken(subject, scopes),
    token_type: 'Bearer',
    expires_in: ACCESS_MINUTES * 60,
  };
}

/**
 * Exchange a refresh token for a new access token.
 *
 * Returns null on any failure, for the same reason `verifyMcpJwt` does.
 *
 * What this deliberately does NOT do is rotate the refresh token. Rotation —
 * issuing a new refresh token each exchange and invalidating the old one — is
 * the stronger design because it DETECTS theft: if a thief and the legitimate
 * client both use the same token, one presents a superseded one and you know.
 * But that requires server-side state recording which tokens have been used,
 * and this endpoint is deliberately stateless. A half-rotation with nothing to
 * compare against would look like protection while providing none. If you want
 * rotation, add a token store first.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number } | null> {
  const key = secretKey();
  if (!key) return null;

  try {
    const { payload } = await jwtVerify(refreshToken, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [ALG],
      requiredClaims: ['sub', 'exp', 'iat', 'typ'],
    });

    // An access token must not mint more access tokens — that would make a
    // leaked access token effectively permanent.
    if (payload.typ !== TYP_REFRESH) {
      console.warn(`mcp-auth: refresh rejected — '${String(payload.typ)}' token`);
      return null;
    }

    const raw = payload.scopes;
    const scopes = Array.isArray(raw)
      ? raw.map(String)
      : typeof raw === 'string'
        ? raw.split(/\s+/).filter(Boolean)
        : [MCP_SCOPE];

    return {
      access_token: await signAccessToken(String(payload.sub), scopes),
      token_type: 'Bearer',
      expires_in: ACCESS_MINUTES * 60,
    };
  } catch (err) {
    console.warn(`mcp-auth: refresh rejected (${(err as Error).name})`);
    return null;
  }
}
