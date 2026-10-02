// Ambient declaration for gtag.js, loaded by src/components/analytics/GA4.tsx.
// `window.gtag` is only defined at runtime when NEXT_PUBLIC_GA4_ID is set —
// callers must still guard with `typeof window.gtag === 'function'`.
export {};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}
