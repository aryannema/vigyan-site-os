/**
 * Token type confusion is the failure this file exists to prevent.
 *
 * Access and refresh tokens are signed with the same key, by the same issuer,
 * for the same audience. The ONLY thing separating them is the `typ` claim. If
 * a future change drops that check, every test below still compiles, the
 * signature still verifies, and a long-lived refresh token silently becomes a
 * tool-calling credential — which is exactly the thing short access lifetimes
 * were introduced to prevent.
 *
 * So these assert both directions, not just the happy path.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret-at-least-thirty-two-characters-long';

let auth: typeof import('../lib/mcp-auth');

beforeAll(async () => {
  process.env.MCP_JWT_SECRET = SECRET;
  auth = await import('../lib/mcp-auth');
});

describe('access tokens', () => {
  it('verifies and carries its subject and scopes', async () => {
    const token = await auth.signAccessToken('agent@example.com');
    const verified = await auth.verifyMcpJwt(token);

    expect(verified).not.toBeNull();
    expect(verified!.subject).toBe('agent@example.com');
    expect(verified!.scopes).toContain(auth.MCP_SCOPE);
  });

  it('is short-lived', async () => {
    const token = await auth.signAccessToken('agent@example.com');
    const verified = await auth.verifyMcpJwt(token);
    const secondsLeft = verified!.expiresAt - Math.floor(Date.now() / 1000);

    expect(secondsLeft).toBeLessThanOrEqual(auth.ACCESS_MINUTES * 60 + 5);
    expect(secondsLeft).toBeGreaterThan(0);
  });

  it('is rejected without the mcp scope', async () => {
    const token = await auth.signAccessToken('agent@example.com', ['something-else']);
    expect(await auth.verifyMcpJwt(token)).toBeNull();
  });
});

describe('token type confusion', () => {
  it('REFUSES a refresh token where an access token is required', async () => {
    const refresh = await auth.signRefreshToken('agent@example.com');

    // Same key, same issuer, same audience, same scopes, valid signature, not
    // expired. Only `typ` differs — and that must be enough to reject it.
    expect(await auth.verifyMcpJwt(refresh)).toBeNull();
  });

  it('REFUSES an access token where a refresh token is required', async () => {
    const access = await auth.signAccessToken('agent@example.com');

    // The converse matters just as much: if an access token could mint new
    // access tokens, a leaked one would be effectively permanent.
    expect(await auth.refreshAccessToken(access)).toBeNull();
  });
});

describe('refresh', () => {
  it('exchanges a refresh token for a usable access token', async () => {
    const refresh = await auth.signRefreshToken('agent@example.com');
    const issued = await auth.refreshAccessToken(refresh);

    expect(issued).not.toBeNull();
    expect(issued!.token_type).toBe('Bearer');

    const verified = await auth.verifyMcpJwt(issued!.access_token);
    expect(verified).not.toBeNull();
    expect(verified!.subject).toBe('agent@example.com');
  });

  it('carries the original scopes onto the new access token', async () => {
    const refresh = await auth.signRefreshToken('agent@example.com', [auth.MCP_SCOPE, 'extra']);
    const issued = await auth.refreshAccessToken(refresh);
    const verified = await auth.verifyMcpJwt(issued!.access_token);

    expect(verified!.scopes).toEqual([auth.MCP_SCOPE, 'extra']);
  });

  it('rejects a token signed with a different secret', async () => {
    const refresh = await auth.signRefreshToken('agent@example.com');

    process.env.MCP_JWT_SECRET = 'a-completely-different-secret-thirty-two-plus';
    vi.resetModules();
    const other = await import('../lib/mcp-auth');
    expect(await other.refreshAccessToken(refresh)).toBeNull();

    process.env.MCP_JWT_SECRET = SECRET;
    vi.resetModules();
    auth = await import('../lib/mcp-auth');
  });

  it('rejects rubbish', async () => {
    expect(await auth.refreshAccessToken('not.a.token')).toBeNull();
    expect(await auth.refreshAccessToken('')).toBeNull();
  });
});

describe('weak secrets', () => {
  it('disables JWT auth rather than accepting a short secret', async () => {
    process.env.MCP_JWT_SECRET = 'too-short';
    vi.resetModules();
    const weak = await import('../lib/mcp-auth');

    // Silently accepting a 9-character HS256 key would be worse than refusing:
    // it is brute-forceable offline from any token signed with it.
    expect(weak.jwtEnabled()).toBe(false);

    process.env.MCP_JWT_SECRET = SECRET;
    vi.resetModules();
  });
});
