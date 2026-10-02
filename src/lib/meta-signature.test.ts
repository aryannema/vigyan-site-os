import { describe, it, expect } from 'vitest';
import { verifyMetaSignature, signLikeMeta } from './meta-signature';

const SECRET = 'a-meta-app-secret';
const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '919999999999' }] } }] }] });

describe('Meta webhook signature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyMetaSignature(body, signLikeMeta(body, SECRET), SECRET)).toEqual({ ok: true });
  });

  it('rejects a forged body — the attack this exists to stop', () => {
    const forged = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '918888888888' }] } }] }] });
    // Signature taken from the real body, applied to a different one.
    expect(verifyMetaSignature(forged, signLikeMeta(body, SECRET), SECRET).ok).toBe(false);
  });

  it('rejects a body signed with the wrong secret', () => {
    expect(verifyMetaSignature(body, signLikeMeta(body, 'wrong-secret'), SECRET)).toEqual({
      ok: false, reason: 'mismatch',
    });
  });

  it('rejects a single flipped character', () => {
    const sig = signLikeMeta(body, SECRET);
    const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
    expect(verifyMetaSignature(body, tampered, SECRET).ok).toBe(false);
  });

  it('distinguishes "not configured" from "forged"', () => {
    // These need different responses: one is our misconfiguration, the other is
    // an attack. Collapsing them hides whichever matters.
    expect(verifyMetaSignature(body, signLikeMeta(body, SECRET), null)).toEqual({
      ok: false, reason: 'not_configured',
    });
    expect(verifyMetaSignature(body, null, SECRET)).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects a header that is not sha256=', () => {
    expect(verifyMetaSignature(body, 'sha1=abc', SECRET)).toEqual({ ok: false, reason: 'bad_format' });
    expect(verifyMetaSignature(body, 'garbage', SECRET)).toEqual({ ok: false, reason: 'bad_format' });
  });

  it('is sensitive to whitespace, which is why the RAW body must be used', () => {
    const sig = signLikeMeta(body, SECRET);
    // Re-serialising after a parse produces different bytes and fails.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyMetaSignature(reserialised, sig, SECRET).ok).toBe(false);
  });
});
