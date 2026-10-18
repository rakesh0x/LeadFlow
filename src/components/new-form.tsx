"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createFormAction } from "@/app/actions";
import { Button, Icon } from "./ui";

/** make a small public page that drops people straight into the workspace. */
export function NewFormButton({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) setTimeout(() => firstRef.current?.focus(), 40);
  }, [open]);

  const save = () => {
    setError(null);
    if (!name.trim()) return setError("the form needs a name");
    startTransition(async () => {
      const result = await createFormAction({ name, source_id: sourceId || null });
      if (!result.ok) return setError(result.error ?? "could not save that");
      setOpen(false);
      setName("");
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        new form
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
          <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="slide-in panel relative w-full max-w-md overflow-hidden !rounded-xl p-0 shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em]">new form</h2>
              <button onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
                <Icon name="close" className="size-3.5" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">name</span>
                <input
                  ref={firstRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field"
                  placeholder="book a demo"
                />
                <span className="mt-1 block text-[11px] text-faint">the web address comes from the name</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">which source should they count as?</span>
                <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="field">
                  <option value="">no source</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <p className="rounded-[8px] bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed text-muted">
                it asks for a name, an email and a company. that is enough to get going — you can point a button or a
                whole page at it.
              </p>

              {error ? <p className="text-[12px] text-rose">{error}</p> : null}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <p className="text-[11.5px] text-faint">you get the link straight away</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  cancel
                </Button>
                <Button variant="primary" size="sm" onClick={save} disabled={pending}>
                  {pending ? "saving…" : "create form"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}