"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createSequenceAction } from "@/app/actions";
import { Button, Icon } from "./ui";

type Draft = { subject: string; content: string; waitDays: number };

const BLANK: Draft = { subject: "", content: "", waitDays: 0 };

/** build a sequence one step at a time, then save it. */
export function NewSequenceButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<Draft[]>([{ ...BLANK }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) setTimeout(() => firstRef.current?.focus(), 40);
  }, [open]);

  const update = (index: number, patch: Partial<Draft>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const save = () => {
    setError(null);
    const kept = steps.filter((s) => s.subject.trim() || s.content.trim());
    if (!name.trim()) return setError("the sequence needs a name");
    if (!kept.length) return setError("add at least one step — even a short subject is enough");

    startTransition(async () => {
      const result = await createSequenceAction({
        name,
        description: goal.trim() || null,
        steps: kept.map((s) => ({
          subject: s.subject.trim(),
          content: s.content.trim(),
          waitDays: Number(s.waitDays) || 0,
          channel: "email" as const,
        })),
      });
      if (!result.ok) return setError(result.error ?? "could not save that");
      setOpen(false);
      setName("");
      setGoal("");
      setSteps([{ ...BLANK }]);
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        new sequence
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[5vh]">
          <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="slide-in panel relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden !rounded-xl p-0 shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.01em]">new sequence</h2>
                <p className="mt-0.5 text-[11.5px] text-muted">a few short messages, sent days apart</p>
              </div>
              <button onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
                <Icon name="close" className="size-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-muted">name</span>
                  <input
                    ref={firstRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field"
                    placeholder="the short introduction"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-muted">what is it for?</span>
                  <input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    className="field"
                    placeholder="a reply, not a demo — for founders at seed stage saas companies"
                  />
                </label>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12.5px] font-medium text-ink">the steps</h3>
                  <button
                    onClick={() => setSteps((prev) => [...prev, { ...BLANK }])}
                    className="inline-flex items-center gap-1 text-[11.5px] text-accent-ink hover:underline"
                  >
                    <Icon name="plus" className="size-3" />
                    add a step
                  </button>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  the wait is how many days to sit on this one before the next one goes out.
                </p>

                <ol className="mt-3 space-y-2.5">
                  {steps.map((step, i) => (
                    <li key={i} className="rounded-[9px] border border-line bg-surface-2/50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11.5px] font-medium text-muted">step {i + 1}</span>
                        {steps.length > 1 ? (
                          <button
                            onClick={() => setSteps((prev) => prev.filter((_, index) => index !== i))}
                            className="grid size-5 place-items-center rounded text-faint hover:bg-surface-3 hover:text-rose"
                            aria-label="remove this step"
                          >
                            <Icon name="close" className="size-3" />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 space-y-2">
                        <input
                          value={step.subject}
                          onChange={(e) => update(i, { subject: e.target.value })}
                          className="field"
                          placeholder="subject line"
                        />
                        <textarea
                          value={step.content}
                          onChange={(e) => update(i, { content: e.target.value })}
                          rows={2}
                          className="field resize-none"
                          placeholder="what you want to say"
                        />
                        <label className="flex items-center gap-2 text-[11.5px] text-muted">
                          wait
                          <input
                            type="number"
                            min={0}
                            max={90}
                            value={step.waitDays}
                            onChange={(e) => update(i, { waitDays: Number(e.target.value) })}
                            className="field h-7 w-20 py-0 text-[12px]"
                          />
                          {step.waitDays === 1 ? "day" : "days"} before the next step
                        </label>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {error ? <p className="mt-3 text-[12px] text-rose">{error}</p> : null}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <p className="text-[11.5px] text-faint">nothing sends until someone is enrolled</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  cancel
                </Button>
                <Button variant="primary" size="sm" onClick={save} disabled={pending}>
                  {pending ? "saving…" : "save sequence"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}