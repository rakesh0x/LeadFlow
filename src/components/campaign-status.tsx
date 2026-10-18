"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCampaignAction } from "@/app/actions";
import { Icon } from "./ui";
import type { Campaign } from "@/lib/types";

const STATUSES: Array<{ value: Campaign["status"]; label: string; hint: string }> = [
  { value: "draft", label: "draft", hint: "nothing has gone out yet" },
  { value: "active", label: "active", hint: "we are sending" },
  { value: "paused", label: "paused", hint: "on hold for now" },
  { value: "completed", label: "completed", hint: "we are done with it" },
];

const TONE: Record<string, string> = {
  draft: "bg-slate-soft text-slate",
  active: "bg-green-soft text-green",
  paused: "bg-amber-soft text-amber",
  completed: "bg-blue-soft text-blue",
  archived: "bg-stone-soft text-stone",
};

/** move a campaign between draft, active, paused and completed. */
export function CampaignStatus({ campaignId, status }: { campaignId: string; status: Campaign["status"] }) {
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

  const choose = (next: Campaign["status"]) => {
    setOpen(false);
    if (next === status) return;
    startTransition(async () => {
      await updateCampaignAction(campaignId, { status: next });
      router.refresh();
    });
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50 ${
          TONE[status] ?? TONE.draft
        }`}
        title="change where this campaign is"
      >
        <span className="size-1.5 rounded-full bg-current opacity-70" />
        {status}
        <Icon name="chevron" className="size-2.5 rotate-90 opacity-60" />
      </button>

      {open ? (
        <div className="slide-in absolute left-0 top-8 z-50 w-[230px] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-3 py-2 text-[11px] text-muted">where is this campaign</p>
          <ul className="py-1">
            {STATUSES.map((s) => (
              <li key={s.value}>
                <button
                  type="button"
                  onClick={() => choose(s.value)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] text-ink">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${TONE[s.value]}`}>{s.label}</span>
                    {s.value === status ? <Icon name="check" className="size-3 text-green" /> : null}
                  </span>
                  <span className="text-[11px] text-muted">{s.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** a plain badge, for the places where the status is just being shown. */
export function CampaignStatusBadge({ status }: { status: Campaign["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TONE[status] ?? TONE.draft}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}
