"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteTaskAction, reopenTaskAction, updateTaskAction } from "@/app/actions";
import { Button, Icon } from "./ui";

type Status = "open" | "in_progress" | "completed" | "cancelled";

/** the small row of controls under each task: start it, move it, undo it, bin it. */
export function TaskActions({ taskId, status }: { taskId: string; status: Status }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const done = status === "completed" || status === "cancelled";

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      await fn();
      setMenuOpen(false);
      setConfirming(false);
      router.refresh();
    });
  };

  const move = (date: Date | null) => run(() => updateTaskAction(taskId, { due_at: date ? date.toISOString() : null }));
  const pickDate = (value: string) => move(value ? new Date(`${value}T17:00:00.000Z`) : null);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {!done && status !== "in_progress" ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => updateTaskAction(taskId, { status: "in_progress" }))}
          title="pick this up and start"
        >
          in progress
        </Button>
      ) : null}

      {!done ? (
        <div className="relative" ref={menuRef}>
          <Button size="xs" variant="ghost" onClick={() => setMenuOpen((v) => !v)} title="move the date">
            move
            <Icon name="chevron" className="size-2.5 rotate-90 opacity-60" />
          </Button>

          {menuOpen ? (
            <div className="slide-in absolute right-0 top-7 z-50 w-[210px] rounded-xl border border-line bg-surface p-1.5 shadow-lg">
              <p className="px-2 py-1 text-[10.5px] text-faint">move it to</p>
              <MenuItem label="today" onClick={() => move(startOfToday())} />
              <MenuItem label="tomorrow" onClick={() => move(addDays(1))} />
              <MenuItem label="next week" onClick={() => move(addDays(7))} />
              <MenuItem label="next month" onClick={() => move(addDays(30))} />
              <div className="my-1 h-px bg-line" />
              <label className="block px-1">
                <span className="mb-1 block px-1 text-[10.5px] text-faint">or pick a day</span>
                <input
                  type="date"
                  className="field !py-1 !text-[12px]"
                  onChange={(e) => e.target.value && pickDate(e.target.value)}
                />
              </label>
              <div className="my-1 h-px bg-line" />
              <MenuItem label="no date" onClick={() => move(null)} />
            </div>
          ) : null}
        </div>
      ) : null}

      {done ? (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => reopenTaskAction(taskId))} title="put it back on the list">
          reopen
        </Button>
      ) : null}

      {confirming ? (
        <span className="flex items-center gap-1">
          <Button size="xs" variant="danger" disabled={pending} onClick={() => run(() => deleteTaskAction(taskId))}>
            really delete
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            keep it
          </Button>
        </span>
      ) : (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => setConfirming(true)} title="remove this task">
          delete
        </Button>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-[7px] px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-surface-2"
    >
      {label}
    </button>
  );
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

function addDays(days: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + days);
  return d;
}
