"use client";

import { useOptimistic, useTransition } from "react";
import { completeTaskAction } from "@/app/actions";
import { Icon } from "./ui";

/** ticking a task off in place, without leaving the page. */
export function TaskTick({
  taskId,
  done = false,
  size = "md",
}: {
  taskId: string;
  done?: boolean;
  size?: "sm" | "md";
}) {
  const [, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useOptimistic(done, (_state: boolean, next: boolean) => next);

  if (optimisticDone) {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-[5px] bg-green text-white ${
          size === "sm" ? "size-[15px]" : "size-[18px]"
        }`}
        title="done"
      >
        <Icon name="check" className={size === "sm" ? "size-2.5" : "size-3"} />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setOptimisticDone(true);
        startTransition(async () => {
          await completeTaskAction(taskId);
        });
      }}
      className={`grid shrink-0 place-items-center rounded-[5px] border border-line-strong text-transparent transition-colors hover:border-accent hover:text-accent ${
        size === "sm" ? "size-[15px]" : "size-[18px]"
      }`}
      title="mark done"
      aria-label="mark done"
    >
      <Icon name="check" className={size === "sm" ? "size-2.5" : "size-3"} />
    </button>
  );
}