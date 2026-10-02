export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-hairline-strong px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}
