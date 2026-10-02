import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Steps } from './steps';

const steps = [
  { id: 'a', label: 'Your name' },
  { id: 'b', label: 'Verify WhatsApp' },
  { id: 'c', label: 'Billing location' },
];

describe('Steps', () => {
  it('renders as an ordered list, so the sequence is conveyed non-visually', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={1} />);
    expect(html).toContain('<ol');
    expect(html).toContain('<li');
    expect(html).toContain('aria-label="Progress"');
  });

  it('marks exactly one step as current', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={1} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it('states each step\'s status in text, not colour alone', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={1} />);
    expect(html).toContain('completed');
    expect(html).toContain('current step');
    expect(html).toContain('not started');
  });

  it('shows a check for done steps and a number for the rest', () => {
    const html = renderToStaticMarkup(<Steps steps={steps} current={2} />);
    // Two completed -> two check icons; the third shows its number.
    expect(html.match(/lucide-check/g)?.length).toBe(2);
    expect(html).toContain('>3<');
  });

  it('handles the first and last step without special-casing', () => {
    for (const c of [0, steps.length - 1]) {
      const html = renderToStaticMarkup(<Steps steps={steps} current={c} />);
      expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    }
  });
});
