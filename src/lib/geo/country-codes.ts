import iso from 'i18n-iso-countries';

/**
 * GA4's `countryId` dimension returns ISO 3166-1 ALPHA-2 codes (e.g. "IN"),
 * confirmed live via the runReport pre-flight check against the real GA4
 * property. `world-atlas`'s countries-110m.json topojson features are keyed
 * by ISO 3166-1 NUMERIC id (e.g. "356"), also confirmed by directly parsing
 * one feature. These don't join directly -- this is the one crosswalk call
 * site, isolated so it can be swapped if a future world-atlas version ever
 * changes its id convention.
 */
export function alpha2ToNumeric(alpha2: string): string | null {
  return iso.alpha2ToNumeric(alpha2) ?? null;
}
