import { supabaseAdmin } from '@/lib/supabase';
import type { FloorPolicy } from '@/lib/margin';
import { PricingCalculator } from './PricingCalculator';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing calculator' };

/**
 * The pricing calculator.
 *
 * Every number here already existed in src/lib/margin.ts, but only ever ran
 * server-side to REFUSE a save -- so a price was set blind and the floor was
 * discovered by hitting it. This shows the same arithmetic BEFORE the decision,
 * including the thing a list price never reveals: what a discount does to the cut.
 *
 * It reads the same pricing_* config the admin save path enforces, so the answer
 * here and the rule there cannot drift.
 */
export default async function PricingPage() {
  const { data } = await supabaseAdmin
    .from('app_config')
    .select('key, value')
    .like('key', 'pricing_%');

  const cfg = new Map((data ?? []).map((r) => [r.key as string, Number(r.value)]));
  const policy: FloorPolicy = {
    minNetPaise: cfg.get('pricing_min_net_paise') ?? 0,
    minNetBp: cfg.get('pricing_min_net_bp') ?? 0,
    gstRateBp: 1800,
    gatewayFeeBp: cfg.get('pricing_gateway_fee_bp') ?? 200,
    gatewayFeeGstBp: cfg.get('pricing_gateway_fee_gst_bp') ?? 1800,
    hostingPerSalePaise: cfg.get('pricing_hosting_per_sale_paise') ?? 0,
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold text-ink">Pricing calculator</h2>
        <p className="text-sm text-body">
          What you actually keep after GST, the gateway&apos;s cut, and hosting — and how far a discount
          can go before a sale stops being worth making.
        </p>
        <p className="text-xs text-muted">
          Nothing here is saved. It reads the same floor settings the product form enforces, so what it
          says and what the save path allows cannot drift apart. Prices are set on the product itself.
        </p>
      </header>
      <PricingCalculator policy={policy} />
    </div>
  );
}
