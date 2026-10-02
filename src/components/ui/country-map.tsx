import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type * as GeoJSON from 'geojson';
import worldTopology from 'world-atlas/countries-110m.json';

import { cn } from '@/lib/utils';
import { alpha2ToNumeric } from '@/lib/geo/country-codes';

/**
 * A world choropleth -- session/visitor counts by country, bucketed into 5
 * quantile shades of the existing saffron scale (saffron-300..700), zero-data
 * countries in the neutral `well` token. No new colors, matching this repo's
 * dataviz mark spec (single hue per series, real values via native <title>
 * tooltips, no custom tooltip layer -- same convention as LineChart/Sparkline).
 *
 * Plain SVG via d3-geo/topojson-client, NOT react-simple-maps (stale, no
 * React 19 peer support) or @visx/geo (same underlying primitives plus an
 * unneeded React-wrapper layer). d3-geo's geoPath() needs no DOM, so this can
 * be a plain server component -- zero map-rendering JS shipped to the
 * browser, continuing this repo's "hand-roll small SVG charts, no chart
 * dependency" convention as faithfully as a real world map allows.
 *
 * GA4's countryId dimension returns ISO alpha-2 ("IN"); world-atlas's
 * topojson features are keyed by ISO numeric id ("356") -- see
 * src/lib/geo/country-codes.ts for the crosswalk, verified live against both
 * the real GA4 property and a parsed world-atlas feature before this was
 * written (not assumed). `topojson-client` has no usable published types
 * (its DefinitelyTyped package depends on the unpublished
 * `topojson-specification`) -- see src/types/topojson-client.d.ts for the
 * self-contained shim covering the one function used here.
 */

const BUCKET_CLASSES = ['fill-saffron-300', 'fill-saffron-400', 'fill-saffron-500', 'fill-saffron-600', 'fill-saffron-700'];

export interface CountryMapDatum {
  alpha2: string;
  label: string;
  value: number;
}

interface WorldTopology {
  objects: { countries: unknown };
}

export function CountryMap({
  data,
  height = 320,
  className,
}: {
  data: CountryMapDatum[];
  height?: number;
  className?: string;
}) {
  const width = 640;

  const byNumericId = new Map<string, CountryMapDatum>();
  for (const row of data) {
    const numeric = alpha2ToNumeric(row.alpha2);
    if (numeric) byNumericId.set(numeric, row);
  }

  const values = data.map((d) => d.value).filter((v) => v > 0).sort((a, b) => a - b);
  const bucketFor = (value: number): number => {
    if (value <= 0 || values.length === 0) return -1;
    const rank = values.filter((v) => v <= value).length / values.length;
    return Math.min(BUCKET_CLASSES.length - 1, Math.floor(rank * BUCKET_CLASSES.length));
  };

  const topology = worldTopology as unknown as WorldTopology;
  const countries = feature(topology, topology.objects.countries);

  const projection = geoNaturalEarth1().fitSize(
    [width, height],
    countries as unknown as GeoJSON.FeatureCollection,
  );
  const path = geoPath(projection);

  return (
    <div className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Sessions by country">
        {countries.features.map((f) => {
          const row = f.id ? byNumericId.get(f.id) : undefined;
          const bucket = row ? bucketFor(row.value) : -1;
          const fillClass = bucket >= 0 ? BUCKET_CLASSES[bucket] : 'fill-well';
          const d = path(f as unknown as GeoJSON.Feature) ?? undefined;
          if (!d) return null;
          return (
            <path key={f.id ?? Math.random()} d={d} className={cn(fillClass, 'stroke-paper')} strokeWidth={0.5}>
              <title>{row ? `${row.label}: ${row.value.toLocaleString()} sessions` : 'No sessions in this range'}</title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}
