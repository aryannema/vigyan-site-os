'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { VBField, runRules } from '@/components/ui/vb-field';
import type { FieldDef, FormSchema } from '@/lib/form-schema';
import { slugify } from '@/app/(app)/admin/lib/form';
import { PriceCalculator } from '@/components/forms/PriceCalculator';

/** Shape returned by the admin server actions (admin/lib/form.ts). */
type ActionState = { error?: string; fieldErrors?: Record<string, string> };

/**
 * SchemaForm — renders a FormSchema (src/lib/form-schema.ts).
 *
 * Every field's validation comes from its `rules` array, which the server
 * re-runs through the same `runRules`, so a rule is declared once and cannot
 * drift between client and server. Adding a field is an edit to the schema,
 * not to this component.
 *
 * Submits as a normal FormData POST to a server action, so it keeps working
 * without JS and needs no bespoke serialisation per form.
 */
export default function SchemaForm({
  schema,
  initial = {},
  action,
  submitLabel,
}: {
  schema: FormSchema;
  initial?: Record<string, string>;
  /** A server action in the admin's useActionState shape, so this form drops
   *  into the existing audited mutate()/perform_action() path unchanged. */
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of schema.fields) seed[f.name] = initial[f.name] ?? '';
    return seed;
  });
  const [submitted, setSubmitted] = React.useState(false);
  // Tracks which derived fields the user has typed in, so we stop
  // auto-deriving the moment they take control of one.
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  const set = (name: string, value: string) => {
    setValues((v) => {
      const next = { ...v, [name]: value };
      // Derive dependents (slug from title) until the user edits them.
      for (const f of schema.fields) {
        if (f.deriveFrom === name && !touched[f.name]) {
          next[f.name] = slugify(value);
        }
      }
      return next;
    });
  };

  // Mirror the client's own rule evaluation so the submit button reflects
  // real validity rather than just "required fields non-empty".
  const invalid = schema.fields.some(
    (f) => runRules(values[f.name] ?? '', f.rules ?? [], values) !== '',
  );

  const renderField = (f: FieldDef) => {
    const common = { key: f.name, className: f.wide ? 'sm:col-span-2' : undefined };

    if (f.type === 'select') {
      const show = submitted && runRules(values[f.name] ?? '', f.rules ?? [], values);
      // A value set elsewhere (MCP, an older record) may not be in the list.
      // Show it rather than rendering a blank select that submits nothing.
      const current = values[f.name] ?? '';
      const options = f.options ?? [];
      const extra = current && !options.some((o) => o.value === current)
        ? [{ value: current, label: current }]
        : [];
      return (
        <div {...common} className={`flex flex-col gap-[7px] ${f.wide ? 'sm:col-span-2' : ''}`}>
          <label htmlFor={f.name} className="text-[13px] font-semibold text-foreground">
            {f.label}
          </label>
          <select
            id={f.name}
            name={f.name}
            value={values[f.name] ?? ''}
            onChange={(e) => set(f.name, e.target.value)}
            className="w-full rounded-ui-md border border-input bg-card px-3.5 py-3 text-sm text-foreground outline-none focus:border-primary"
          >
            {[...extra, ...options].map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="min-h-4 text-xs text-muted-foreground">{show || f.hint || ''}</span>
        </div>
      );
    }

    if (f.type === 'datetime') {
      return (
        <div {...common} className={`flex flex-col gap-[7px] ${f.wide ? 'sm:col-span-2' : ''}`}>
          <label htmlFor={f.name} className="text-[13px] font-semibold text-foreground">
            {f.label}
          </label>
          {/* datetime-local gives the browser's own date AND time pickers, which
              are keyboard-accessible and localised, and it needs no library.
              The value is local time; the server converts to UTC on save, so
              "valid till 9pm" means 9pm where the admin is. */}
          <input
            id={f.name}
            name={f.name}
            type="datetime-local"
            value={values[f.name] ?? ''}
            onChange={(e) => set(f.name, e.target.value)}
            className="w-full rounded-ui-md border border-input bg-card px-3.5 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="min-h-4 text-xs text-muted-foreground">{f.hint || ''}</span>
        </div>
      );
    }

    if (f.type === 'textarea') {
      return (
        <div {...common} className={`flex flex-col gap-[7px] ${f.wide ? 'sm:col-span-2' : ''}`}>
          <label htmlFor={f.name} className="text-[13px] font-semibold text-foreground">
            {f.label}
          </label>
          <textarea
            id={f.name}
            name={f.name}
            rows={4}
            value={values[f.name] ?? ''}
            placeholder={f.placeholder}
            onChange={(e) => set(f.name, e.target.value)}
            className="w-full resize-y rounded-ui-md border border-input bg-card px-3.5 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="min-h-4 text-xs text-muted-foreground">{f.hint || ''}</span>
        </div>
      );
    }

    const serverError = state?.fieldErrors?.[f.name];
    return (
      <div {...common} className={f.wide ? 'sm:col-span-2' : undefined}>
        <VBField
          name={f.name}
          label={f.label}
          hint={serverError ?? f.hint}
          rules={f.rules}
          value={values[f.name] ?? ''}
          values={values}
          submitted={submitted}
          placeholder={f.placeholder}
          inputMode={f.type === 'money' ? 'decimal' : undefined}
          onChange={(v) => {
            if (f.deriveFrom) setTouched((t) => ({ ...t, [f.name]: true }));
            set(f.name, v);
          }}
        />
      </div>
    );
  };

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmitted(true)}
      className="flex flex-col gap-6"
    >
      {state?.error && (
        <div role="alert" className="rounded-ui-md border border-destructive/25 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
          {state.error}
        </div>
      )}

      {schema.description && (
        <p className="text-sm text-muted-foreground">{schema.description}</p>
      )}

      {/* Shown on any form that has a price: the operator decides what to keep,
          not what to charge, and the calculator fills the fields in. */}
      {schema.fields.some((f) => f.name === 'price_rupees') && (
        <PriceCalculator
          onApply={({ priceRupees, discountPercent }) => {
            setValues((v) => ({ ...v, price_rupees: priceRupees, discount_percent: discountPercent }));
            setTouched((t) => ({ ...t, price_rupees: true, discount_percent: true }));
          }}
        />
      )}

      {/* Ungrouped fields first, then each section as its own visible block.
          Fields that only make sense together should read as one unit rather
          than as separate questions scattered down the form. */}
      <div className="grid gap-5 sm:grid-cols-2">
        {schema.fields.filter((f) => !f.section).map(renderField)}
      </div>

      {(schema.sections ?? []).map((section) => {
        const fields = schema.fields.filter((f) => f.section === section.id);
        if (!fields.length) return null;
        return (
          <fieldset
            key={section.id}
            className="rounded-ui-lg border border-input bg-card/40 p-5"
          >
            <legend className="px-2 text-[13px] font-semibold text-foreground">
              {section.title}
              {section.optional && (
                <span className="ml-2 font-normal text-muted-foreground">optional</span>
              )}
            </legend>
            {section.description && (
              <p className="mb-4 text-xs text-muted-foreground">{section.description}</p>
            )}
            <div className="grid gap-5 sm:grid-cols-2">{fields.map(renderField)}</div>
          </fieldset>
        );
      })}

      <div>
        <button
          type="submit"
          disabled={submitted && invalid}
          className="inline-flex h-11 items-center rounded-ui-lg bg-primary px-6 text-sm font-bold text-primary-foreground transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
