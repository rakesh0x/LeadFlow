"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setStageAction } from "@/app/actions";
import type { PipelineStage } from "@/lib/domain";
import { Icon } from "./ui";
import { QuickTask } from "./quick-task";

/** the three things you do to an untouched lead: keep it, bin it, come back to it. */
export function InboxActions({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<PipelineStage | null>(null);

  const move = (stage: PipelineStage) => {
    setDone(stage);
    startTransition(async () => {
      await setStageAction(leadId, stage);
      setDone(null);
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => move("qualified")}
        disabled={pending}
        className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-green-soft hover:text-green disabled:opacity-45"
        title="this one is worth our time"
      >
        {done === "qualified" ? <Icon name="check" className="size-3" /> : null}
        qualify
      </button>

      <button
        type="button"
        onClick={() => move("disqualified")}
        disabled={pending}
        className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-rose-soft hover:text-rose disabled:opacity-45"
        title="not a fit for us"
      >
        {done === "disqualified" ? <Icon name="check" className="size-3" /> : null}
        disqualify
      </button>

      <QuickTask leadId={leadId} leadName={leadName} label="task" defaultTitle={`look into ${leadName.split(/\s+/)[0]?.toLowerCase() ?? "this lead"}`} />

      <Link
        href={`/leads/${leadId}`}
        className="inline-flex h-6 items-center rounded-[6px] px-1.5 text-[11.5px] text-accent-ink transition-colors hover:bg-accent-soft"
        title="open the full record"
      >
        open
      </Link>
    </div>
  );
}
