/**
 * Token refresh — exchange a refresh token for a new access token.
 *
 *   POST /api/mcp/refresh
 *   { "refresh_token": "..." }
 *
 *   -> { "access_token": "...", "token_type": "Bearer", "expires_in": 900 }
 *
 * Why this is a separate route from /api/mcp: the refresh token should travel
 * as rarely as possible. Sending it here, and only here, means it is absent
 * from every ordinary tool call — so it spends far less time in transit, in
 * proxy logs, and in whatever captures request headers.
 *
 * The refresh token is read from the BODY, not the Authorization header. That
 * is deliberate: access tokens live in that header, and if both arrived the same
 * way a client bug could easily send the wrong one. Different position, harder
 * to confuse.
 *
 * No rotation. See `refreshAccessToken()` for why — detecting a stolen refresh
 * token needs server-side state this endpoint deliberately does not keep, and a
 * rotation with nothing to compare against would look like protection while
 * providing none.
 */
import { NextResponse } from 'next/server';

import { jwtEnabled, refreshAccessToken } from '@/lib/mcp-auth';

export async function POST(request: Request) {
  if (!jwtEnabled()) {
    return NextResponse.json(
      {
        error: 'JWT authentication is not configured.',
        detail:
          'Set MCP_JWT_SECRET (at least 32 characters) to issue and refresh tokens. ' +
          'Generate one with: pnpm mcp:token --new-secret',
      },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const token =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).refresh_token
      : null;

  if (typeof token !== 'string' || !token) {
    return NextResponse.json(
      { error: 'Send { "refresh_token": "<token>" }.' },
      { status: 400 },
    );
  }

  const issued = await refreshAccessToken(token);
  if (!issued) {
    // Same opacity as everywhere else: expired, wrong signature, and "that is
    // an access token, not a refresh token" are one answer to the caller, and
    // three different lines in the server log.
    return NextResponse.json(
      { error: 'The refresh token was not accepted. Obtain a new token pair.' },
      { status: 401 },
    );
  }

  return NextResponse.json(issued, {
    status: 200,
    // A token is not cacheable by anything, ever.
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use POST with { "refresh_token": "..." }.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
