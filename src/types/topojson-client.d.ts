// `topojson-client` ships no types of its own, and its DefinitelyTyped
// package (`@types/topojson-client`) imports from `topojson-specification`,
// which was unpublished from npm in 2023 -- installing it 404s, and the
// upstream types package is broken for anyone using strict module
// resolution. Deliberately self-contained (no dependency on the geojson or
// topojson-specification type packages) rather than working around a dead
// upstream package. Covers only the one function this repo actually calls
// (src/components/ui/country-map.tsx).
declare module 'topojson-client' {
  export interface TopojsonFeature {
    type: 'Feature';
    id?: string;
    properties?: Record<string, unknown> | null;
    geometry: unknown;
  }

  export interface TopojsonFeatureCollection {
    type: 'FeatureCollection';
    features: TopojsonFeature[];
  }

  export function feature(topology: unknown, object: unknown): TopojsonFeatureCollection;
}
