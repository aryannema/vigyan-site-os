/**
 * GST computation.
 *
 * Razorpay does NOT do this. A payment gateway moves money and reports what it
 * moved; deciding the rate, the split, and whether tax applies at all is the
 * seller's liability. So it is computed here, server-side, and recorded on the
 * order — never recomputed later, because rates change and an invoice must
 * always reproduce the tax actually charged on the day.
 *
 * All money is paise, all rates are basis points. No floats anywhere: 18% of
 * ₹999 in floating point is how a ledger ends up a paisa short.
 *
 * This encodes the ordinary place-of-supply rules for services. It is not tax
 * advice — rates, SAC codes and the export conditions should be confirmed with
 * your CA, which is exactly why they are configuration rather than constants.
 */

export type TaxTreatment = 'intra_state' | 'inter_state' | 'export_zero_rated' | 'exempt';

export interface TaxInput {
  /** The product's price, in paise. */
  priceP: number;
  /** Rate in basis points. 1800 = 18%. 0 = exempt. */
  rateBp: number;
  /** Our own registered state code, e.g. '29' for Karnataka. */
  sellerStateCode: string;
  /** Buyer's state code. Null when unknown or outside India. */
  buyerStateCode: string | null;
  /** ISO country. 'IN' for India. */
  buyerCountry: string;
  /** Whether the displayed price already includes tax. */
  pricesIncludeTax: boolean;
}

export interface TaxResult {
  treatment: TaxTreatment;
  /** Taxable value. */
  baseP: number;
  cgstP: number;
  sgstP: number;
  igstP: number;
  /** What the customer actually pays. Always base + cgst + sgst + igst. */
  totalP: number;
  rateBp: number;
  placeOfSupply: string | null;
  /** Plain-language line for the checkout summary and the invoice. */
  label: string;
}

/**
 * Splits an amount by a basis-point rate without floating point.
 *
 * Exclusive: tax = base * rate / 10000.
 * Inclusive: base = total * 10000 / (10000 + rate), and tax is the remainder —
 * derived by subtraction so the parts always re-add to the total exactly. Doing
 * it the other way round leaves a rounding crumb that makes an invoice fail to
 * balance.
 */
function split(amountP: number, rateBp: number, inclusive: boolean): { baseP: number; taxP: number } {
  if (rateBp <= 0) return { baseP: amountP, taxP: 0 };
  if (inclusive) {
    const baseP = Math.round((amountP * 10000) / (10000 + rateBp));
    return { baseP, taxP: amountP - baseP };
  }
  return { baseP: amountP, taxP: Math.round((amountP * rateBp) / 10000) };
}

export function computeTax(input: TaxInput): TaxResult {
  const { priceP, rateBp, sellerStateCode, buyerStateCode, buyerCountry, pricesIncludeTax } = input;

  // 1. Outside India — export of services, zero-rated. No Indian GST is
  //    charged. This is conditional on payment in convertible foreign exchange
  //    and on an LUT/bond being on file; without the LUT, IGST is payable and
  //    reclaimed later. We record the treatment so that decision is auditable
  //    rather than assumed.
  if (buyerCountry && buyerCountry.toUpperCase() !== 'IN') {
    return {
      treatment: 'export_zero_rated',
      baseP: priceP,
      cgstP: 0,
      sgstP: 0,
      igstP: 0,
      totalP: priceP,
      rateBp: 0,
      placeOfSupply: null,
      label: 'Export of services — zero-rated, no GST',
    };
  }

  // 2. Exempt product.
  if (rateBp <= 0) {
    return {
      treatment: 'exempt',
      baseP: priceP, cgstP: 0, sgstP: 0, igstP: 0, totalP: priceP,
      rateBp: 0,
      placeOfSupply: buyerStateCode ?? sellerStateCode,
      label: 'No GST applicable',
    };
  }

  const { baseP, taxP } = split(priceP, rateBp, pricesIncludeTax);
  const totalP = pricesIncludeTax ? priceP : baseP + taxP;
  const pct = (rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 2);

  // 3. Unknown buyer state falls back to OUR state. For an unregistered
  //    recipient with no address on record the place of supply is the
  //    supplier's location, so this is the correct default rather than a guess
  //    — but collecting the state is still better, because it changes the
  //    split for genuinely inter-state buyers.
  const effectiveBuyerState = buyerStateCode || sellerStateCode;

  if (effectiveBuyerState === sellerStateCode) {
    // Intra-state: the rate is split in half between centre and state. Assign
    // the remainder to CGST so the two halves always re-add to taxP exactly.
    const cgstP = Math.round(taxP / 2);
    return {
      treatment: 'intra_state',
      baseP,
      cgstP,
      sgstP: taxP - cgstP,
      igstP: 0,
      totalP,
      rateBp,
      placeOfSupply: effectiveBuyerState,
      label: `CGST ${(rateBp / 200).toFixed(1)}% + SGST ${(rateBp / 200).toFixed(1)}% (${pct}% GST)`,
    };
  }

  return {
    treatment: 'inter_state',
    baseP,
    cgstP: 0,
    sgstP: 0,
    igstP: taxP,
    totalP,
    rateBp,
    placeOfSupply: effectiveBuyerState,
    label: `IGST ${pct}%`,
  };
}

/** GSTIN's first two digits are the state code; they must agree with the address. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const m = gstin.trim().match(/^(\d{2})[A-Z]{5}\d{4}[A-Z]/i);
  return m ? m[1] : null;
}

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' }, { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];
