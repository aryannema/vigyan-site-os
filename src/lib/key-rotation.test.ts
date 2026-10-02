import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Round-trip tests for versioned encryption.
 *
 * The property that matters: a value encrypted under an OLD key must still
 * decrypt after a new key becomes current. If that fails, rotation is
 * impossible and the key can never change.
 */
describe('versioned encryption', () => {
  beforeAll(() => {
    process.env.CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.CONFIG_ENCRYPTION_KEY_V2 = 'b'.repeat(64);
    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '1';
  });

  it('round-trips on v1, with no prefix for backward compatibility', async () => {
    const { encryptSecret, decryptSecret, ciphertextVersion } = await import('./app-secrets');
    const ct = encryptSecret('0150836818');
    expect(ct.startsWith('v')).toBe(false);
    expect(ciphertextVersion(ct)).toBe(1);
    expect(decryptSecret(ct)).toBe('0150836818');
  });

  it('writes a prefix from v2 onward, and still reads v1', async () => {
    const m = await import('./app-secrets');
    const oldCt = m.encryptSecret('old-secret', 1);

    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '2';
    const newCt = m.encryptSecret('new-secret');
    expect(newCt.startsWith('v2:')).toBe(true);

    // The point of the whole design: the old value is still readable after the
    // current version moved on.
    expect(m.decryptSecret(oldCt)).toBe('old-secret');
    expect(m.decryptSecret(newCt)).toBe('new-secret');
  });

  it('rotates a v1 value onto v2 without changing the plaintext', async () => {
    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '1';
    const m = await import('./app-secrets');
    const original = m.encryptSecret('account-number');

    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '2';
    const { value, changed } = m.rotateCiphertext(original);

    expect(changed).toBe(true);
    expect(m.ciphertextVersion(value)).toBe(2);
    expect(m.decryptSecret(value)).toBe('account-number');
    // Re-encrypted, not merely relabelled.
    expect(value).not.toBe(original);
  });

  it('is a no-op on a value already current, so a rerun is safe', async () => {
    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '2';
    const m = await import('./app-secrets');
    const ct = m.encryptSecret('x');
    const { value, changed } = m.rotateCiphertext(ct);
    expect(changed).toBe(false);
    expect(value).toBe(ct);
  });

  it('refuses to guess when a needed key is absent', async () => {
    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '2';
    const m = await import('./app-secrets');
    const ct = m.encryptSecret('x');
    const saved = process.env.CONFIG_ENCRYPTION_KEY_V2;
    delete process.env.CONFIG_ENCRYPTION_KEY_V2;
    // Failing loudly beats silently returning nonsense: a missing key means
    // those rows are unreadable, and that must be obvious.
    expect(() => m.decryptSecret(ct)).toThrow(/No key for encryption version 2/);
    process.env.CONFIG_ENCRYPTION_KEY_V2 = saved;
  });

  it('detects a tampered ciphertext rather than returning garbage', async () => {
    process.env.CONFIG_ENCRYPTION_KEY_CURRENT = '1';
    const m = await import('./app-secrets');
    const ct = m.encryptSecret('sensitive');
    const raw = Buffer.from(ct, 'base64');
    raw[raw.length - 1] ^= 0xff;
    // GCM authenticates; a flipped bit fails the tag check.
    expect(() => m.decryptSecret(raw.toString('base64'))).toThrow();
  });

  it('fingerprints a key without revealing it', async () => {
    const m = await import('./app-secrets');
    const fp = m.keyFingerprint(1);
    expect(fp).toHaveLength(16);
    expect(fp).not.toContain('a'.repeat(20));
  });
});
