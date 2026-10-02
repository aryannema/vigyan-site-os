import { secretMatches } from '@/lib/app-secrets';
import { NextResponse } from 'next/server';
import { purgeExpiredGracePeriods } from '@/lib/account-deletion';

/**
 * Permanently purges any account_deletion_grace snapshot past its 15-day
 * window (migration 022) -- this is what makes the grace period genuinely
 * bounded rather than an indefinite decrypt-anytime copy. Triggered by a
 * Coolify Scheduled Task (registered 2026-09-09, daily 04:00) hitting this
 * route from inside the app container itself -- same CRON_SECRET-gated
 * pattern as api/cron/publish-scheduled, whose own trigger was found dead
 * (still configured only in the now-unused vercel.json from before the
 * Vercel->Hostinger migration) while wiring this one up; both are now
 * registered as real Coolify Scheduled Tasks.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  // Fails closed: with CRON_SECRET unset this used to accept any caller.
  if (!(await secretMatches('CRON_SECRET', authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await purgeExpiredGracePeriods();
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ status: 'ok', purged: result.purged });
}
