import { Check } from 'lucide-react';

/**
 * Step indicator for a multi-part form.
 *
 * Built from the shadcn "page heading with steps" block, with its markup
 * corrected: that version uses divs and anchors, which leaves a screen reader
 * with no idea this is a sequence, how long it is, or where the user is in it.
 * A step sequence IS an ordered list, so this uses <ol>/<li> and marks the
 * current step with aria-current, which is the one attribute that makes the
 * whole thing legible non-visually.
 *
 * Purely presentational — it reflects progress, it does not control it. The
 * form decides what is complete.
 */

export interface Step {
  id: string;
  label: string;
  /** Shown under the label on wider screens. */
  hint?: string;
}

export function Steps({
  steps,
  current,
  className,
}: {
  steps: Step[];
  /** Zero-based index of the step being worked on. */
  current: number;
  className?: string;
}) {
  return (
    <nav aria-label="Progress" className={className}>
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;

          return (
            <li
              key={step.id}
              className="flex items-start gap-3 sm:flex-1 sm:flex-col sm:gap-2"
              aria-current={active ? 'step' : undefined}
            >
              <div className="flex w-full items-center gap-3">
                <span
                  className={[
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition',
                    done
                      ? 'bg-primary text-primary-foreground'
                      : active
                        ? 'bg-primary text-primary-foreground ring-4 ring-saffron-500/20'
                        : 'border border-input bg-card text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                  {/* The number alone does not say what state this is in. */}
                  <span className="sr-only">
                    {done ? ' — completed' : active ? ' — current step' : ' — not started'}
                  </span>
                </span>

                {/* Connector. Hidden from assistive tech: the list order already
                    conveys the sequence, and a decorative line would only add
                    noise. */}
                <span
                  aria-hidden
                  className={[
                    'hidden h-px flex-1 sm:block',
                    done ? 'bg-primary' : 'bg-hairline',
                  ].join(' ')}
                />
              </div>

              <div className="min-w-0 sm:pr-6">
                <p
                  className={[
                    'text-[13px] font-semibold leading-tight',
                    active ? 'text-foreground' : done ? 'text-foreground' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {step.label}
                </p>
                {step.hint && (
                  <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{step.hint}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
