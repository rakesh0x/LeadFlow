"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setStageAction } from "@/app/actions";
import { PIPELINE_STAGES, PIPELINE_STAGE_META, type PipelineStage } from "@/lib/domain";
import { Icon } from "./ui";

/** move a lead along the pipeline in one click, without opening anything. */
export function StageSelect({
  leadId,
  stage,
  label = "move",
  align = "right",
  showCurrent = false,
}: {
  leadId: string;
  stage: PipelineStage;
  label?: string;
  align?: "left" | "right";
  showCurrent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const move = (next: PipelineStage) => {
    setOpen(false);
    startTransition(async () => {
      await setStageAction(leadId, next);
    });
  };

  const current = PIPELINE_STAGE_META[stage];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line bg-surface px-1.5 text-[11.5px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-45"
        title="move this lead to another stage"
      >
        {showCurrent ? current.label : label}
        <Icon name="chevron" className="size-3 rotate-90 opacity-60" />
      </button>

      {open ? (
        <div
          className={`slide-in absolute top-7 z-50 w-[178px] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="px-2 py-1.5 text-[10.5px] text-faint">move to</p>
          {PIPELINE_STAGES.map((s) => {
            const meta = PIPELINE_STAGE_META[s];
            const on = s === stage;
            return (
              <button
                key={s}
                type="button"
                onClick={() => move(s)}
                disabled={on}
                className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors ${
                  on ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: `var(--${meta.tone === "stone" ? "slate" : meta.tone})` }}
                />
                <span className="flex-1 truncate">{meta.label}</span>
                {on ? <Icon name="check" className="size-3" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
