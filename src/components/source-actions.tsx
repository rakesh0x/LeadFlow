"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createSourceAction, syncSourceAction, updateSourceAction } from "@/app/actions";
import { SOURCE_KINDS, SOURCE_KIND_META } from "@/lib/domain";
import { Button, Icon } from "./ui";

/** nudge a connected platform to pull fresh leads, or hold it still for a while. */
export function SourceActions({ sourceId, status }: { sourceId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const paused = status === "paused";

  const run = (fn: () => Promise<{ message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.message ?? "done");
      setTimeout(() => setMessage(null), 3500);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="xs"
        variant="secondary"
        disabled={pending || paused}
        onClick={() => run(() => syncSourceAction(sourceId))}
        title="ask the server to pull anything new"
      >
        sync now
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => updateSourceAction(sourceId, { status: paused ? "connected" : "paused" }))}
        title={paused ? "start syncing again" : "stop syncing this source"}
      >
        {paused ? "resume" : "pause"}
      </Button>
      {message ? <span className="text-[11px] text-muted">{message}</span> : null}
    </div>
  );
}

/** add a new platform, import or anything else leads arrive from. */
export function NewSourceButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("integration");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) setTimeout(() => firstRef.current?.focus(), 40);
  }, [open]);

  const save = () => {
    setError(null);
    if (!name.trim()) return setError("the source needs a name");
    startTransition(async () => {
      const result = await createSourceAction({ name, kind, notes: notes.trim() || null });
      if (!result.ok) return setError(result.error ?? "could not save that");
      setOpen(false);
      setName("");
      setNotes("");
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        connect a source
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
          <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="slide-in panel relative w-full max-w-md overflow-hidden !rounded-xl p-0 shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em]">connect a source</h2>
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
                  placeholder="linkedin outreach"
                />
                <span className="mt-1 block text-[11px] text-faint">just so you can tell them apart later</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">what kind is it?</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="field">
                  {SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_KIND_META[k].label} — {SOURCE_KIND_META[k].hint}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">notes (optional)</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="where it came from" />
              </label>

              {error ? <p className="text-[12px] text-rose">{error}</p> : null}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <p className="text-[11.5px] text-faint">we sync it in the background</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  cancel
                </Button>
                <Button variant="primary" size="sm" onClick={save} disabled={pending}>
                  {pending ? "saving…" : "connect"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}