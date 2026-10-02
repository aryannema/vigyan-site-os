import Link from 'next/link';

import { getCompany } from '@/lib/company';
import { getBanking, listAccounts, listDirectors, totalShareholdingBp } from '@/lib/company-private';

import { query } from '../../lib/db';
import { deleteDirector, revealAccount, saveBanking, saveDirector } from './actions';
import { AuditTrail, type AuditRow } from './AuditTrail';
import { AccountsPanel } from './AccountsPanel';
import { makePrimary, revealAccount as revealAccountById, saveAccount } from './account-actions';
import { BankingPanel } from './BankingPanel';
import { CompanyForm } from './CompanyForm';
import { saveCompany } from './company-actions';
import { DirectorsPanel } from './DirectorsPanel';

export const dynamic = 'force-dynamic';

/**
 * Everything about the company, in one place.
 *
 * Three records that used to be spread across two pages and twelve source
 * files: the public identity (name, GSTIN, CIN, address — printed on invoices
 * and legal pages), the private register (directors, shareholding, banking),
 * and the audit trail covering both.
 *
 * Together rather than apart because they are read together: checking who a
 * director is usually happens while checking what the company's details are,
 * and splitting them meant remembering which page held what.
 */
export default async function CompanyInfoPage() {
  const [company, directors, totalBp, banking, accounts, audit] = await Promise.all([
    getCompany(),
    listDirectors(),
    totalShareholdingBp(),
    getBanking(),
    listAccounts(),
    query<AuditRow>(
      `SELECT id, actor, action, target_id, before_data, after_data, created_at
         FROM public.action_audit_log
        WHERE resource_key IN ('settings', 'company_finance')
          AND (target_id IN ('company_profile', 'company_banking', 'company_bank_account')
               OR before_data ? 'din' OR after_data ? 'din')
        ORDER BY created_at DESC
        LIMIT 25`,
    ),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div className="border-b border-hairline pb-6">
        <Link href="/admin/settings" className="mb-2 inline-block text-xs text-muted transition hover:text-saffron-ink">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">Company information</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One record for the company. The details below are printed on invoices and the legal
          pages; the directors and banking are for your own records and filings, are readable
          only by the server, and never appear on the website.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Public details</h2>
          <p className="text-xs text-muted">
            Shown in the footer, on the terms, privacy, refund and data-deletion pages, on both
            invoices, and in the structured data search engines read.
          </p>
        </div>
        <CompanyForm company={company} action={saveCompany} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Directors and shareholders</h2>
          <p className="text-xs text-muted">
            Not published. Add as many as the register needs — the total is checked as you go.
          </p>
        </div>
        <DirectorsPanel
          directors={directors}
          totalBp={totalBp}
          save={saveDirector}
          remove={deleteDirector}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Bank accounts</h2>
          <p className="text-xs text-muted">
            Add as many as you hold. Exactly one active account can be primary — that is where
            settlements go, and the database refuses a second rather than leaving it ambiguous.
            Numbers are encrypted, and viewing one in full is recorded.
          </p>
        </div>
        <AccountsPanel
          accounts={accounts}
          save={saveAccount}
          setPrimary={makePrimary}
          reveal={revealAccountById}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Tax identifiers</h2>
          <p className="text-xs text-muted">TAN and PAN, used for TDS and filings.</p>
        </div>
        <BankingPanel banking={banking} save={saveBanking} reveal={revealAccount} />
      </section>

      <AuditTrail rows={audit} />
    </div>
  );
}
