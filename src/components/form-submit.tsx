"use client";

import { useState, useTransition } from "react";
import { submitFormAction } from "@/app/actions";
import { Button } from "./ui";

type Field = { key: string; label: string; required?: boolean };

/** the public side of a form — no app shell, no jargon, just a way to say hello. */
export function FormSubmit({ slug, name, fields }: { slug: string; name: string; fields: Field[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-green-soft text-green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="size-5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
        </span>
        <p className="text-[15px] font-medium text-ink">thanks — that came through</p>
        <p className="max-w-xs text-[12.5px] leading-relaxed text-muted">{done}</p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const missing = fields.find((f) => f.required && !(values[f.key] ?? "").trim());
        if (missing) return setError(`we still need your ${missing.label.replace(/^your /, "")}`);

        startTransition(async () => {
          const result = await submitFormAction(slug, values);
          if (!result.ok) return setError(result.error ?? "that did not go through — try again?");
          setDone(result.message ?? "we'll be in touch.");
        });
      }}
    >
      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            {field.label}
            {field.required ? <span className="text-rose"> *</span> : <span className="ml-1 text-faint">optional</span>}
          </span>
          {field.key === "message" || field.key === "notes" ? (
            <textarea
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              rows={3}
              className="field resize-none"
              placeholder="tell us a little more"
            />
          ) : (
            <input
              type={field.key === "email" ? "email" : "text"}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="field"
              placeholder={field.key === "email" ? "you@company.com" : field.label}
            />
          )}
        </label>
      ))}

      {error ? <p className="text-[12px] text-rose">{error}</p> : null}

      <Button type="submit" variant="primary" size="md" disabled={pending} className="w-full">
        {pending ? "sending…" : `send ${name}`}
      </Button>
      <p className="pt-1 text-center text-[11px] text-faint">we will only use this to reply to you.</p>
    </form>
  );
}