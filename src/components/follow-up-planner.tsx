"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFollowUpAction, setOutreachStateAction } from "@/app/actions";
import { humanize } from "@/lib/db/time";
import { Icon } from "./ui";

const OPTIONS = [3, 7, 14];

/** decide when to chase a message again — or to stop chasing entirely. */
export function FollowUpPlanner({ messageId, followUpAt }: { messageId: string; followUpAt?: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const set = (days: number | null) => {
    setOpen(false);
    const at = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    startTransition(async () => {
      await setFollowUpAction(messageId, at, days !== null);
      router.refresh();
    });
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium transition-colors hover:opacity-80 disabled:opacity-50 ${
          followUpAt ? "bg-amber-soft text-amber" : "bg-surface-2 text-muted hover:bg-surface-3"
        }`}
        title="when should we chase this"
      >
        <Icon name="clock" className="size-2.5" />
        {followUpAt ? humanize(followUpAt) : "follow up"}
      </button>

      {open ? (
        <div className="slide-in absolute right-0 top-8 z-50 w-[210px] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-3 py-2 text-[11px] text-muted">nudge them in</p>
          <ul className="py-1">
            {OPTIONS.map((d) => (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => set(d)}
                  className="w-full px-3 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-surface-2"
                >
                  {d} days from now
                </button>
              </li>
            ))}
            {followUpAt ? (
              <li className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  onClick={() => set(null)}
                  className="w-full px-3 py-1.5 text-left text-[12.5px] text-rose transition-colors hover:bg-rose-soft"
                >
                  clear it
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** stop chasing this person for now. */
export function GiveUpButton({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setOutreachStateAction(leadId, "closed");
          router.refresh();
        })
      }
      className="rounded-[6px] px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-rose disabled:opacity-50"
      title="stop chasing this one"
    >
      {pending ? "…" : "give up"}
    </button>
  );
}
