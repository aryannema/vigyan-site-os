import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PriceTag } from './PriceTag';
import type { Priceable } from '@/lib/pricing';

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const base: Priceable = { price_paise: 99900, discount_bp: null, offer_ends_at: null, offer_label: null };

describe('PriceTag', () => {
  it('shows only the price when no offer runs', () => {
    const html = renderToStaticMarkup(<PriceTag product={base} />);
    expect(html).toContain('999');
    expect(html).not.toContain('line-through');
  });

  it('strikes the standard price and shows the saving during an offer', () => {
    const html = renderToStaticMarkup(
      <PriceTag product={{ ...base, discount_bp: 2500, offer_ends_at: future, offer_label: 'Launch offer' }} />,
    );
    expect(html).toContain('line-through');
    expect(html).toContain('Launch offer');
    expect(html).toContain('749');   // 25% off 999
    expect(html).toContain('999');   // struck through
  });

  it('renders the deadline as text on the server, before any clock ticks', () => {
    const html = renderToStaticMarkup(
      <PriceTag product={{ ...base, discount_bp: 2500, offer_ends_at: future }} />,
    );
    // Pre-hydration the reader gets the fact, not an empty box.
    expect(html).toContain('until');
    expect(html).toContain('Offer ends');
  });

  it('ignores an expired offer — no dead banner, standard price', () => {
    const html = renderToStaticMarkup(
      <PriceTag product={{ ...base, discount_bp: 2500, offer_ends_at: past, offer_label: 'Gone' }} />,
    );
    expect(html).not.toContain('Gone');
    expect(html).not.toContain('line-through');
    expect(html).toContain('999');
  });

  it('treats a zero price as a quote request, not as free', () => {
    const html = renderToStaticMarkup(<PriceTag product={{ ...base, price_paise: 0 }} />);
    expect(html).toContain('Request a quote');
  });
});
