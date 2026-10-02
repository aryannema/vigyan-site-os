import * as React from "react";

/**
 * YourSite validation layer — the "GrapesJS trait" idea, typed.
 *
 * Drop at: src/components/ui/vb-field.tsx  (sits beside shadcn's input.tsx)
 * Requires shadcn primitives already installed: input, label.
 *
 * Rules are DATA, not code. A field carries its own contract, runs it on blur
 * and on submit, owns its error slot, and reports validity upward. The page
 * never re-implements a rule; a CMS/editor can emit the same JSON.
 */

export type Rule =
  | { kind: "required"; message?: string }
  | { kind: "email"; message?: string }
  | { kind: "min"; value: number; message?: string }
  | { kind: "max"; value: number; message?: string }
  | { kind: "pattern"; value: RegExp | string; message?: string }
  | { kind: "match"; field: string; message?: string }
  | { kind: "custom"; fn: (v: string, all: Record<string, string>) => string | "" };

const DEFAULTS: Record<string, string> = {
  required: "This field is required.",
  email: "Enter a valid work email.",
  pattern: "Invalid format.",
  match: "Values do not match.",
};

export function runRules(
  value: string,
  rules: Rule[] = [],
  all: Record<string, string> = {}
): string {
  const v = String(value ?? "");
  for (const r of rules) {
    if (r.kind === "required" && !v.trim()) return r.message ?? DEFAULTS.required;
    if (!v.trim() && r.kind !== "custom") continue;
    if (r.kind === "email" && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v))
      return r.message ?? DEFAULTS.email;
    if (r.kind === "min" && v.length < r.value)
      return r.message ?? `At least ${r.value} characters.`;
    if (r.kind === "max" && v.length > r.value)
      return r.message ?? `At most ${r.value} characters.`;
    if (r.kind === "pattern") {
      const re = typeof r.value === "string" ? new RegExp(r.value) : r.value;
      if (!re.test(v)) return r.message ?? DEFAULTS.pattern;
    }
    if (r.kind === "match" && v !== all[r.field]) return r.message ?? DEFAULTS.match;
    if (r.kind === "custom") {
      const msg = r.fn(v, all);
      if (msg) return msg;
    }
  }
  return "";
}

export interface VBFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  name: string;
  label: string;
  hint?: string;
  rules?: Rule[];
  /** password field with the eye reveal toggle */
  secret?: boolean;
  value: string;
  values?: Record<string, string>;
  /** forced validation pass, e.g. after submit */
  submitted?: boolean;
  onChange: (value: string) => void;
  onValid?: (ok: boolean) => void;
}

export function VBField({
  name, label, hint, rules = [], secret, value, values = {},
  submitted, onChange, onValid, className, ...rest
}: VBFieldProps) {
  const [touched, setTouched] = React.useState(false);
  const [reveal, setReveal] = React.useState(false);

  const error = runRules(value, rules, values);
  const show = (touched || submitted) && !!error;
  const ok = (touched || submitted) && !error && !!value.trim();

  React.useEffect(() => { onValid?.(!error); }, [error, onValid]);

  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline justify-between gap-2.5">
        <label
          htmlFor={name}
          className={`text-[13px] font-semibold ${show ? "text-destructive" : "text-foreground"}`}
        >
          {label}
        </label>
        {hint && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {hint}
          </span>
        )}
      </div>

      <div className="relative flex items-center">
        <input
          id={name}
          name={name}
          value={value}
          type={secret ? (reveal ? "text" : "password") : rest.type ?? "text"}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={show || undefined}
          aria-describedby={`${name}-msg`}
          className={[
            "w-full rounded-[10px] bg-card px-3.5 py-3 text-sm text-foreground outline-none",
            "border transition-[border-color,box-shadow] duration-150",
            secret ? "pr-11 font-mono" : "",
            show ? "border-destructive" : ok ? "border-accent" : "border-input",
            "focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.18)]",
            className ?? "",
          ].join(" ")}
          {...rest}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide value" : "Show value"}
            className="absolute right-1.5 flex h-8.5 w-8.5 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {reveal && <path d="M3 3l18 18" />}
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
      </div>

      <span
        id={`${name}-msg`}
        role={show ? "alert" : undefined}
        className={`min-h-4 text-xs ${show ? "text-destructive" : "text-accent"}`}
      >
        {show ? error : ok ? "Looks good." : ""}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Usage — the whole point: the page declares intent, not validation logic.

   const [v, setV] = React.useState({ email: "", key: "" });
   const [submitted, setSubmitted] = React.useState(false);

   <VBField
     name="key" label="Deployment key" hint="required · min 12" secret
     value={v.key} values={v} submitted={submitted}
     rules={[{ kind: "required" }, { kind: "min", value: 12 }]}
     onChange={(key) => setV({ ...v, key })}
   />

   Server-side, import runRules from this same file and re-run the identical
   rule array in the route handler — one contract, both sides.
   -------------------------------------------------------------------------- */
