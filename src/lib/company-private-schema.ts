/**
 * Types and validation for directors and banking.
 *
 * Deliberately SEPARATE from company-private.ts, which reaches the database and
 * is therefore server-only. Validation has to run in both places — the form for
 * immediate feedback, the server action for the decision that counts — so it
 * cannot live in a module that drags a database pool into the browser bundle.
 */

export interface Director {
  id: string;
  full_name: string;
  parentage: string | null;
  din: string | null;
  shareholding_bp: number | null;
  role: string;
  appointed_on: string | null;
  is_active: boolean;
  position: number;
}

export interface Banking {
  tan: string | null;
  pan: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  account_number_last4: string | null;
  ifsc: string | null;
  micr: string | null;
  account_type: string | null;
}

export function validateDirector(d: Partial<Director>): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.full_name?.trim()) e.full_name = 'Name is required.';
  if (d.din?.trim() && !/^[0-9]{8}$/.test(d.din.trim())) {
    e.din = 'A DIN is exactly 8 digits.';
  }
  if (d.shareholding_bp != null && (d.shareholding_bp < 0 || d.shareholding_bp > 10000)) {
    e.shareholding_bp = 'A holding is between 0% and 100%.';
  }
  return e;
}

export function validateBanking(
  b: Partial<Banking> & { account_number?: string },
): Record<string, string> {
  const e: Record<string, string> = {};

  if (b.tan?.trim() && !/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(b.tan.trim().toUpperCase())) {
    e.tan = 'A TAN is 10 characters: 4 letters, 5 digits, 1 letter — e.g. BLRV35251G.';
  }
  if (b.pan?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(b.pan.trim().toUpperCase())) {
    e.pan = 'A PAN is 10 characters: 5 letters, 4 digits, 1 letter.';
  }
  if (b.ifsc?.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc.trim().toUpperCase())) {
    // The fifth character of an IFSC is always zero — reserved by the RBI.
    e.ifsc = 'An IFSC is 11 characters: 4 letters, a zero, then 6 — e.g. KKBK0008128.';
  }
  if (b.micr?.trim() && !/^[0-9]{9}$/.test(b.micr.trim())) {
    e.micr = 'An MICR code is exactly 9 digits.';
  }
  if (b.account_number?.trim() && !/^[0-9]{9,18}$/.test(b.account_number.trim())) {
    e.account_number = 'An account number is 9 to 18 digits.';
  }

  return e;
}


export interface CompanyAccount {
  id: string;
  label: string;
  bank_name: string;
  bank_branch: string | null;
  account_number_last4: string;
  ifsc: string | null;
  micr: string | null;
  swift: string | null;
  account_type: string;
  purpose: string | null;
  currency: string;
  is_primary: boolean;
  is_active: boolean;
}

export const ACCOUNT_TYPES = [
  { value: 'current', label: 'Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'od', label: 'Overdraft / cash credit' },
  { value: 'fd', label: 'Fixed deposit' },
  { value: 'escrow', label: 'Escrow' },
];

export function validateAccount(
  a: Partial<CompanyAccount> & { account_number?: string },
  opts: { isNew?: boolean } = {},
): Record<string, string> {
  const e: Record<string, string> = {};

  if (!a.label?.trim()) e.label = 'Give it a name you will recognise, e.g. "Settlement account".';
  if (!a.bank_name?.trim()) e.bank_name = 'Bank name is required.';

  // Required when adding; blank on edit means "keep the existing number".
  if (opts.isNew && !a.account_number?.trim()) {
    e.account_number = 'Account number is required.';
  }
  if (a.account_number?.trim() && !/^[0-9]{9,18}$/.test(a.account_number.trim())) {
    e.account_number = 'An account number is 9 to 18 digits.';
  }

  if (a.ifsc?.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(a.ifsc.trim().toUpperCase())) {
    e.ifsc = 'An IFSC is 11 characters: 4 letters, a zero, then 6 — e.g. KKBK0008128.';
  }
  if (a.micr?.trim() && !/^[0-9]{9}$/.test(a.micr.trim())) {
    e.micr = 'An MICR code is exactly 9 digits.';
  }
  // SWIFT/BIC is 8 or 11 — never 9 or 10.
  if (a.swift?.trim() && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(a.swift.trim().toUpperCase())) {
    e.swift = 'A SWIFT/BIC code is 8 or 11 characters.';
  }

  // An Indian rupee account needs an IFSC to receive anything; a foreign
  // currency account needs a SWIFT. Neither is optional in practice.
  if (a.currency === 'INR' && a.is_active !== false && !a.ifsc?.trim()) {
    e.ifsc = 'An IFSC is needed to receive money into an Indian account.';
  }

  return e;
}

/**
 * Where a DIN can actually be checked.
 *
 * There is no free public API. The MCA publishes director data through a portal
 * that requires a session and blocks automated requests (it answers 403), and
 * the services that do offer programmatic lookup — Signzy, Karza, IDfy and
 * similar — are paid resellers of the same data. A web search does not verify
 * anything: it finds pages that mention a number, which is not the same as
 * confirming the number belongs to a person.
 *
 * So the honest options are format checking (done above), uniqueness (a partial
 * unique index), and a link that takes an administrator to the official page to
 * look. This returns that link.
 */
export const dinLookupUrl = (din: string): string =>
  `https://www.mca.gov.in/mcafoportal/companyLLPMasterData.do?din=${encodeURIComponent(din)}`;
