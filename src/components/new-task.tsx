"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createTaskAction } from "@/app/actions";
import { PRIORITIES, PRIORITY_META, TASK_TYPES, TASK_TYPE_META } from "@/lib/domain";
import { LeadPicker, type PickedLead } from "./lead-picker";
import { Button, Icon } from "./ui";

export interface NewTaskMember {
  id: string;
  name: string;
}

/** the "new task" button and the little window it opens. */
export function NewTaskButton({ members = [], defaultLead = null }: { members?: NewTaskMember[]; defaultLead?: PickedLead | null }) {
  const [open, setOpen] = useState(Boolean(defaultLead));
  const router = useRouter();
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        new task
      </Button>
      {open ? (
        <NewTaskModal
          members={members}
          defaultLead={defaultLead}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export function NewTaskModal({
  members = [],
  defaultLead = null,
  onClose,
}: {
  members?: NewTaskMember[];
  defaultLead?: PickedLead | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [lead, setLead] = useState<PickedLead | null>(defaultLead);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setTimeout(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 40);
  }, []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const due = String(form.get("due") ?? "").trim();
    setError(null);

    startTransition(async () => {
      const result = await createTaskAction({
        title,
        lead_id: lead?.id ?? null,
        type: String(form.get("type") ?? "follow_up") as never,
        priority: String(form.get("priority") ?? "medium") as never,
        due_at: due ? new Date(`${due}T17:00:00.000Z`).toISOString() : null,
        owner_id: (String(form.get("owner_id") ?? "") || null) as string | null,
        description: (String(form.get("description") ?? "").trim() || null) as string | null,
      });
      if (!result.ok) {
        setError(result.error ?? "could not save that task");
        return;
      }
      setSaved(true);
      setTimeout(onClose, 650);
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
      <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="slide-in panel relative w-full max-w-lg overflow-hidden !rounded-xl p-0 shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">new task</h2>
          <button onClick={onClose} className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>

        {saved ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="grid size-9 place-items-center rounded-full bg-green-soft text-green">
              <Icon name="check" className="size-4" />
            </span>
            <p className="text-[13px] text-ink">saved. one less thing to remember.</p>
          </div>
        ) : (
          <form ref={formRef} onSubmit={submit} className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">what needs doing</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="field"
                placeholder="call ana back about the pricing"
                required
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">kind</span>
                <select name="type" className="field" defaultValue="follow_up">
                  {TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TASK_TYPE_META[t].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">how important</span>
                <select name="priority" className="field" defaultValue="medium">
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">when</span>
                <input name="due" type="date" className="field" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">whose is it</span>
                <select name="owner_id" className="field" defaultValue="">
                  <option value="">me</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <span className="mb-1 block text-[11.5px] font-medium text-muted">who is it about</span>
              <LeadPicker value={lead} onChange={setLead} />
            </div>

            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">a note (optional)</span>
              <textarea name="description" rows={2} className="field resize-none" placeholder="anything that helps you later" />
            </label>

            {error ? <p className="text-[12px] text-rose">{error}</p> : null}

            <div className="flex items-center justify-between pt-1">
              <p className="text-[11.5px] text-faint">you can always change this later</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={pending || !title.trim()}>
                  {pending ? "saving…" : "save task"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
