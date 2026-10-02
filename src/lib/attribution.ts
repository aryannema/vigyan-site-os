import { cookies } from 'next/headers';

/**
 * Campaign attribution — the join between a click and a sale.
 *
 * link_clicks counts clicks and orders counts revenue, and before this nothing
 * connected the two: "which campaign actually made money" could not be answered
 * from the data at all. The short-link redirect drops this cookie; the checkout
 * reads it back and stamps the order.
 *
 * Stored as a first-party, httpOnly cookie. It carries campaign identifiers only
 * -- no personal data, nothing about the visitor -- so it is functional to the
 * purchase rather than tracking, and it never leaves this origin.
 */

export const ATTRIBUTION_COOKIE = 'vb_attr';

/**
 * 30 days. Long enough for the common case of "saw it on LinkedIn, bought on
 * Thursday", short enough that a purchase months later is not miscredited to a
 * campaign that had nothing to do with it.
 */
export const ATTRIBUTION_MAX_AGE = 30 * 24 * 60 * 60;

export interface Attribution {
  link_slug?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

/** Last-touch wins: the most recent campaign click is the one credited. */
export function serializeAttribution(a: Attribution): string {
  return JSON.stringify(a);
}

/**
 * Parse and sanitise the cookie value.
 *
 * Pure and exported so it is testable: this string is ATTACKER-CONTROLLED --
 * anyone can set a cookie -- and it ends up in a database row, so it must never
 * be spread in unchecked. Only the four known keys survive, each a bounded
 * string; anything else is dropped rather than rejected, because a malformed
 * cookie should cost the buyer their attribution, never their purchase.
 */
export function parseAttribution(raw: string | undefined): Attribution {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const source = parsed as Record<string, unknown>;
  const clean: Attribution = {};
  for (const k of ['link_slug', 'utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const v = source[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) clean[k] = v;
  }
  return clean;
}

export async function readAttribution(): Promise<Attribution> {
  try {
    return parseAttribution((await cookies()).get(ATTRIBUTION_COOKIE)?.value);
  } catch {
    return {};
  }
}
