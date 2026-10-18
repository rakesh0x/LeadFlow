"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createTaskAction } from "@/app/actions";
import { PRIORITIES, PRIORITY_META, TASK_TYPES, TASK_TYPE_META } from "@/lib/domain";
import { Button, Icon } from "./ui";

/** a tiny form that drops a task next to a lead without leaving the page. */
export function QuickTask({
  leadId,
  leadName,
  label = "task",
  defaultTitle,
  align = "right",
}: {
  leadId: string;
  leadName?: string | null;
  label?: string;
  defaultTitle?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle ?? `follow up with ${firstName(leadName)}`);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("due") ?? "").trim();
    setError(null);

    startTransition(async () => {
      const result = await createTaskAction({
        title: String(form.get("title") ?? ""),
        lead_id: leadId,
        type: String(form.get("type") ?? "follow_up") as never,
        priority: String(form.get("priority") ?? "medium") as never,
        due_at: date ? new Date(`${date}T17:00:00.000Z`).toISOString() : null,
      });
      if (!result.ok) {
        setError(result.error ?? "could not add that task");
        return;
      }
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setOpen(false);
      }, 900);
    });
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        title="add a task"
      >
        {done ? <Icon name="check" className="size-3 text-green" /> : <Icon name="tasks" className="size-3 text-faint" />}
        {done ? "added" : label}
      </button>

      {open ? (
        <div
          className={`slide-in absolute top-7 z-50 w-[264px] rounded-xl border border-line bg-surface p-3 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <form onSubmit={submit} className="space-y-2.5">
            <input ref={inputRef} name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="field !py-1.5 !text-[12.5px]" placeholder="what needs doing" />

            <div className="grid grid-cols-2 gap-2">
              <select name="type" className="field !py-1.5 !text-[12px]" defaultValue="follow_up">
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TASK_TYPE_META[t].label}
                  </option>
                ))}
              </select>
              <select name="priority" className="field !py-1.5 !text-[12px]" defaultValue="medium">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </div>

            <input name="due" type="date" className="field !py-1.5 !text-[12px]" aria-label="when is it due" />

            {error ? <p className="text-[11.5px] text-rose">{error}</p> : null}

            <div className="flex items-center justify-between pt-0.5">
              <button type="button" onClick={() => setOpen(false)} className="text-[11.5px] text-muted hover:text-ink">
                cancel
              </button>
              <Button type="submit" variant="primary" size="xs" disabled={pending}>
                {pending ? "adding…" : "add task"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function firstName(name?: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first.toLowerCase() : "them";
}
