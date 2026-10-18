"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

export interface Alert {
  id: string;
  kind: "overdue" | "inbox" | "replies" | "reengage" | "dupes" | "tasks";
  title: string;
  detail: string;
  count: number;
  href: string;
  tone: "rose" | "amber" | "blue" | "violet" | "slate";
}

export function NotificationsMenu({ alertCount, alerts = [] }: { alertCount: number; alerts?: Alert[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const dot: Record<string, string> = {
    rose: "bg-rose",
    amber: "bg-amber",
    blue: "bg-blue",
    violet: "bg-violet",
    slate: "bg-slate",
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-7.5 place-items-center rounded-[7px] border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        title="what needs you"
        aria-label="what needs you"
      >
        <Icon name="clock" className="size-4" />
        {alertCount > 0 ? (
          <span className="num absolute -right-1 -top-1 grid min-w-[15px] place-items-center rounded-full bg-rose px-1 text-[9.5px] font-semibold leading-[15px] text-white">
            {alertCount > 99 ? "99+" : alertCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="slide-in absolute right-0 top-9 z-50 w-[340px] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <div className="border-b border-line px-3.5 py-2.5">
            <p className="text-[13px] font-semibold">what needs you</p>
            <p className="text-[11.5px] text-muted">everything below is counting against you right now</p>
          </div>
          <ul className="max-h-[380px] overflow-y-auto py-1">
            {alerts.length === 0 ? (
              <li className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                <span className="grid size-8 place-items-center rounded-full bg-green-soft text-green">
                  <Icon name="check" className="size-4" />
                </span>
                <p className="text-[13px] font-medium text-ink">nothing is waiting</p>
                <p className="text-[11.5px] text-muted">go find some new leads</p>
              </li>
            ) : (
              alerts.map((alert) => (
                <li key={alert.id}>
                  <Link href={alert.href} onClick={() => setOpen(false)} className="flex items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-surface-2">
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot[alert.tone]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12.5px] text-ink">{alert.title}</span>
                        <span className="num shrink-0 text-[11.5px] text-muted">{alert.count}</span>
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{alert.detail}</span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}