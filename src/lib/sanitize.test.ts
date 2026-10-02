import { describe, it, expect } from 'vitest';
import { sanitizeRich, sanitizeInline, stripHtml } from './sanitize';

describe('sanitiser', () => {
  it('removes a script tag', () => {
    expect(sanitizeRich('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('removes event handlers', () => {
    const out = sanitizeRich('<p onclick="alert(1)">Click</p>')!;
    expect(out).not.toContain('onclick');
    expect(out).toContain('Click');
  });

  it('blocks javascript: and data: URLs — the usual way a link runs code', () => {
    expect(sanitizeRich('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeRich('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toContain('data:');
  });

  it('keeps a real link and hardens it', () => {
    const out = sanitizeRich('<a href="https://example.com">x</a>')!;
    expect(out).toContain('https://example.com');
    expect(out).toContain('noopener');
  });

  it('keeps the formatting an author actually uses', () => {
    const out = sanitizeRich('<p><strong>Role</strong></p><ul><li>One</li></ul><h2>About</h2>')!;
    expect(out).toContain('<strong>');
    expect(out).toContain('<li>');
    expect(out).toContain('<h2>');
  });

  it('survives the classic evasions', () => {
    for (const payload of [
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<iframe src="https://evil.test"></iframe>',
      '<a href="jAvAsCrIpT:alert(1)">x</a>',
      '<style>body{background:url("javascript:alert(1)")}</style>',
    ]) {
      const out = sanitizeRich(payload)!;
      expect(out.toLowerCase()).not.toContain('onerror');
      expect(out.toLowerCase()).not.toContain('onload');
      expect(out.toLowerCase()).not.toContain('javascript');
      expect(out.toLowerCase()).not.toContain('<iframe');
    }
  });

  it('inline mode drops block tags', () => {
    expect(sanitizeInline('<p>a</p><strong>b</strong>')).toBe('a<strong>b</strong>');
  });

  it('stripHtml leaves only text', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('passes null through rather than inventing a value', () => {
    expect(sanitizeRich(null)).toBeNull();
    expect(stripHtml(undefined)).toBeNull();
  });
});
