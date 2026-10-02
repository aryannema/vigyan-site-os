/**
 * ConfirmPlaceholder — a deliberately loud marker for copy that is not yet
 * confirmed.
 *
 * The brand brief is explicit: where a fact is missing (prices, plan names,
 * feature limits, client names, numbers) put a clearly marked placeholder
 * rather than inventing one. Inventing a price or a metric is the worst
 * possible failure mode for a site whose whole positioning is "trust,
 * built in".
 *
 * It is styled to be impossible to miss in a screenshot or a casual review,
 * so a page carrying unconfirmed copy cannot quietly reach production. Every
 * instance is also listed in the sync report.
 */
export default function ConfirmPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <mark
      data-confirm-placeholder=""
      className="rounded-ui-sm border border-dashed border-saffron-700 bg-saffron-500/15 px-1.5 py-0.5 font-mono text-[0.9em] text-saffron-ink"
    >
      [[CONFIRM: {children}]]
    </mark>
  );
}
