import Link from "next/link";
import { siteConfig } from "@/config/site";
import BrandMark from "@/components/brand/BrandMark";

/**
 * Brand — the YourSite wordmark lockup. "Vigyan" is theme ink/cream, "Bytes"
 * carries the single warm gold accent -- matches the approved reference lockup
 * (badge + "igyanBytes", cream + gold, no green). Never orange+green together;
 * that combination reads as the Indian tricolor.
 */
export default function Brand() {
  return (
    <Link
      href="/"
      aria-label={`${siteConfig.name} home`}
      className="group relative inline-flex items-center gap-2.5 shrink-0 transition-opacity hover:opacity-90"
    >
      {/* Mobile: the minimalist mandala mark only */}
      <span className="md:hidden">
        <BrandMark size={36} on="ivory" className="dark:hidden" />
        <BrandMark size={36} on="deep" className="hidden dark:block" />
      </span>

      {/* Desktop: badge + wordmark text (light + dark variants) */}
      <span className="hidden items-center gap-2.5 md:inline-flex">
        <BrandMark size={36} on="ivory" className="dark:hidden" />
        <BrandMark size={36} on="deep" className="hidden dark:block" />
        <span className="text-lg font-extrabold tracking-tight">
          <span className="text-ink">Vigyan</span>
          <span className="text-saffron-500">Bytes</span>
        </span>
      </span>

      {/* Hidden system-access affordance (kept from prior build). */}
      <Link
        href="/login"
        aria-hidden="true"
        className="absolute inset-0 z-10 cursor-default opacity-0"
        title="System Access"
        tabIndex={-1}
      />
    </Link>
  );
}
