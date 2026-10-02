import Link from 'next/link';

import { currentKeyVersion } from '@/lib/app-secrets';
import { rotationHistory, versionCounts } from '@/lib/key-rotation';

import { runRotation } from './actions';
import { RotationPanel } from './RotationPanel';

export const dynamic = 'force-dynamic';

export default async function KeysPage() {
  const [counts, history] = await Promise.all([versionCounts(), rotationHistory(10)]);
  const current = currentKeyVersion();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="border-b border-hairline pb-6">
        <Link href="/admin/settings" className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Encryption keys</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every stored secret — API tokens, bank account numbers — is encrypted with a key that
          lives only in the server&apos;s environment, never in the database. Rotating means
          re-encrypting all of it onto a new key, one value at a time.
        </p>
      </div>

      <RotationPanel counts={counts} history={history} current={current} action={runRotation} />
    </div>
  );
}
