import { describe, it, expect } from 'vitest';
import { validateAccount, validateDirector, dinLookupUrl } from './company-private-schema';

const account = {
  label: 'Settlement', bank_name: 'Kotak Mahindra Bank',
  ifsc: 'KKBK0008128', micr: '560485117', currency: 'INR',
  account_number: '0150836818',
};

describe('director validation', () => {
  it('accepts a real director', () => {
    expect(validateDirector({ full_name: 'Founder Name', din: '00000000', shareholding_bp: 9900 })).toEqual({});
  });

  it('requires exactly 8 digits for a DIN', () => {
    for (const bad of ['1178233', '117823345', '1178233a']) {
      expect(validateDirector({ full_name: 'X', din: bad }).din).toBeTruthy();
    }
    expect(validateDirector({ full_name: 'X', din: '00000000' }).din).toBeUndefined();
  });

  it('allows a director with no shareholding', () => {
    expect(validateDirector({ full_name: 'X', shareholding_bp: null })).toEqual({});
  });

  it('rejects a holding above 100%', () => {
    expect(validateDirector({ full_name: 'X', shareholding_bp: 10001 }).shareholding_bp).toBeTruthy();
  });

  it('builds an MCA lookup link', () => {
    expect(dinLookupUrl('00000000')).toContain('00000000');
    expect(dinLookupUrl('00000000')).toMatch(/^https:\/\/www\.mca\.gov\.in/);
  });
});

describe('bank account validation', () => {
  it('accepts the real account', () => {
    expect(validateAccount(account, { isNew: true })).toEqual({});
  });

  it('requires an account number when adding, not when editing', () => {
    const { account_number, ...noNumber } = account;
    expect(validateAccount(noNumber, { isNew: true }).account_number).toBeTruthy();
    // Blank on edit means "keep the existing number", not "erase it".
    expect(validateAccount(noNumber, { isNew: false }).account_number).toBeUndefined();
  });

  it('rejects a malformed IFSC — the fifth character is always zero', () => {
    expect(validateAccount({ ...account, ifsc: 'KKBK1008128' }).ifsc).toBeTruthy();
    expect(validateAccount({ ...account, ifsc: 'KKBK000812' }).ifsc).toBeTruthy();
    expect(validateAccount({ ...account, ifsc: 'KKBK0008128' }).ifsc).toBeUndefined();
  });

  it('accepts SWIFT at 8 or 11, and nothing in between', () => {
    expect(validateAccount({ ...account, swift: 'KKBKINBB' }).swift).toBeUndefined();
    expect(validateAccount({ ...account, swift: 'KKBKINBBXXX' }).swift).toBeUndefined();
    expect(validateAccount({ ...account, swift: 'KKBKINBBX' }).swift).toBeTruthy();
  });

  it('insists an active rupee account has an IFSC', () => {
    // Without one it cannot receive money, so saving it would look configured
    // while being unusable.
    expect(validateAccount({ ...account, ifsc: null }).ifsc).toBeTruthy();
    // A closed account is a record, not a destination.
    expect(validateAccount({ ...account, ifsc: null, is_active: false }).ifsc).toBeUndefined();
  });

  it('checks the account number length', () => {
    expect(validateAccount({ ...account, account_number: '12345678' }).account_number).toBeTruthy();
    expect(validateAccount({ ...account, account_number: '1'.repeat(19) }).account_number).toBeTruthy();
    expect(validateAccount({ ...account, account_number: '123456789' }).account_number).toBeUndefined();
  });
});
