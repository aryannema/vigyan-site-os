import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SchemaForm from '@/components/forms/SchemaForm';
import { PRODUCT_FORM, paiseToRupees, rupeesToPaise } from '@/lib/form-schema';

const noop = async () => ({});

describe('SchemaForm / PRODUCT_FORM', () => {
  it('renders every field in the product schema', () => {
    const html = renderToStaticMarkup(
      <SchemaForm schema={PRODUCT_FORM} action={noop} submitLabel="Create product"
        initial={{ status: 'draft', category: 'saas', price_rupees: '0' }} />,
    );
    for (const f of PRODUCT_FORM.fields) {
      expect(html, `missing field ${f.name}`).toContain(`name="${f.name}"`);
      expect(html, `missing label for ${f.name}`).toContain(f.label);
    }
    expect(html).toContain('Create product');
  });

  it('keeps a category value that is not in the option list', () => {
    const html = renderToStaticMarkup(
      <SchemaForm schema={PRODUCT_FORM} action={noop} submitLabel="Save"
        initial={{ category: 'set-via-mcp', status: 'active', price_rupees: '0' }} />,
    );
    expect(html).toContain('set-via-mcp');
  });

  it('round-trips money through paise without float drift', () => {
    expect(rupeesToPaise('1999.99')).toBe(199999);
    expect(paiseToRupees(199999)).toBe('1999.99');
    expect(rupeesToPaise(paiseToRupees(rupeesToPaise('0.07')))).toBe(7);
  });
});
