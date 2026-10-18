"use client";

import { useState } from "react";
import { Icon } from "./ui";

/**
 * takes you straight to the first thing still waiting, so a long list is never
 * the reason you stop.
 */
export function NextTaskButton({ targetId }: { targetId?: string | null }) {
  const [nudged, setNudged] = useState(false);

  if (!targetId) return null;

  const go = () => {
    const node = document.getElementById(`task-${targetId}`);
    if (!node) {
      setNudged(true);
      setTimeout(() => setNudged(false), 2500);
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("ring-2", "ring-accent", "ring-offset-2", "ring-offset-canvas");
    setTimeout(() => node.classList.remove("ring-2", "ring-accent", "ring-offset-2", "ring-offset-canvas"), 1600);
  };

  return (
    <button
      type="button"
      onClick={go}
      className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
      title="jump to the next one that is not done yet"
    >
      <Icon name="arrow" className="size-3.5 text-faint" />
      {nudged ? "nothing pending here" : "next one"}
    </button>
  );
}
