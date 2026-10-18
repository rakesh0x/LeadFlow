"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createLeadAction } from "@/app/actions";
import { Button, Icon } from "./ui";

const SOURCE_HINT = [
  { value: "", label: "where did they come from?" },
  { value: "website", label: "website" },
  { value: "linkedin", label: "linkedin" },
  { value: "referral", label: "a referral" },
  { value: "import", label: "an import" },
  { value: "conference", label: "a conference" },
];

export function NewLeadButton({ sources = [] }: { sources?: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 40);
  }, [open]);

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createLeadAction({
        full_name: String(formData.get("full_name") ?? ""),
        email: (formData.get("email") as string) || null,
        phone: (formData.get("phone") as string) || null,
        job_title: (formData.get("job_title") as string) || null,
        company_name: (formData.get("company_name") as string) || null,
        company_website: (formData.get("company_website") as string) || null,
        linkedin_url: (formData.get("linkedin_url") as string) || null,
        location: (formData.get("location") as string) || null,
        source_id: (formData.get("source_id") as string) || null,
        notes: (formData.get("notes") as string) || null,
      });
      if (!result.ok) {
        setError(result.error ?? "could not add that lead");
        return;
      }
      setMessage(result.message ?? "added");
      setTimeout(() => {
        setOpen(false);
        setMessage(null);
        formRef.current?.reset();
        router.refresh();
      }, 700);
    });
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)} title="add a lead (⌘n)">
        <Icon name="plus" className="size-3.5" />
        <span className="hidden sm:inline">add lead</span>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[8vh]">
          <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="slide-in panel relative w-full max-w-lg overflow-hidden !rounded-xl p-0 shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em]">add a lead</h2>
              <button onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
                <Icon name="close" className="size-3.5" />
              </button>
            </div>

            {message ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="grid size-9 place-items-center rounded-full bg-green-soft text-green">
                  <Icon name="check" className="size-4" />
                </span>
                <p className="text-[13px] text-ink">{message}</p>
              </div>
            ) : (
              <form ref={formRef} action={submit} className="space-y-3 p-4">
                <Row label="name" required>
                  <input name="full_name" className="field" placeholder="jane doe" required />
                </Row>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="email">
                    <input name="email" type="email" className="field" placeholder="jane@acme.com" />
                  </Row>
                  <Row label="phone">
                    <input name="phone" className="field" placeholder="+1 415 555 0100" />
                  </Row>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="company">
                    <input name="company_name" className="field" placeholder="acme" />
                  </Row>
                  <Row label="company website">
                    <input name="company_website" className="field" placeholder="acme.com" />
                  </Row>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="job title">
                    <input name="job_title" className="field" placeholder="head of growth" />
                  </Row>
                  <Row label="location">
                    <input name="location" className="field" placeholder="berlin, de" />
                  </Row>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row label="linkedin">
                    <input name="linkedin_url" className="field" placeholder="linkedin.com/in/jane" />
                  </Row>
                  <Row label="source">
                    <select name="source_id" className="field">
                      {SOURCE_HINT.filter((s) => !s.value || sources.some((x) => x.name.toLowerCase().includes(s.value))).map((s) => (
                        <option key={s.value} value="">
                          {s.label}
                        </option>
                      ))}
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Row>
                </div>
                <Row label="notes">
                  <textarea name="notes" rows={2} className="field resize-none" placeholder="anything worth remembering" />
                </Row>

                {error ? <p className="text-[12px] text-rose">{error}</p> : null}

                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11.5px] text-faint">we'll check if we already know this person</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                      cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" disabled={pending}>
                      {pending ? "adding…" : "add lead"}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Row({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-muted">
        {label}
        {required ? <span className="text-rose"> *</span> : null}
      </span>
      {children}
    </label>
  );
}