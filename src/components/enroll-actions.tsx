"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeEnrollmentAction, enrollLeadAction, pauseEnrollmentAction } from "@/app/actions";
import { Button } from "./ui";

/** pause, resume or finish the sequence one lead is sitting in. */
export function EnrollActions({ enrollmentId, paused, finished }: { enrollmentId: string; paused?: boolean; finished?: boolean }) {
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const run = (fn: () => Promise<{ message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.message ?? "done");
      setTimeout(() => setMessage(null), 2200);
      router.refresh();
    });
  };

  if (finished) {
    return <span className="shrink-0 text-[11.5px] text-faint">finished</span>;
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="xs"
        variant="ghost"
        onClick={() => run(() => pauseEnrollmentAction(enrollmentId, !paused))}
        title={paused ? "start sending again" : "stop sending for now"}
      >
        {paused ? "resume" : "pause"}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => run(() => completeEnrollmentAction(enrollmentId))}
        title="we are done with this sequence"
      >
        finish
      </Button>
      {message ? <span className="text-[11px] text-muted">{message}</span> : null}
    </div>
  );
}

/** for leads that are not in anything yet — pick a sequence and start one. */
export function EnrollSelect({ leadId, sequences }: { leadId: string; sequences: Array<{ id: string; name: string; steps: number }> }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  if (!sequences.length) {
    return <span className="shrink-0 text-[11.5px] text-faint">no sequences yet</span>;
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <select
        className="field h-6 w-auto py-0 pr-6 text-[11.5px]"
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          const sequenceId = e.target.value;
          if (!sequenceId) return;
          startTransition(async () => {
            const result = await enrollLeadAction(leadId, sequenceId);
            setMessage(result.ok ? "added" : (result.error ?? "could not add them"));
            setTimeout(() => setMessage(null), 2200);
            router.refresh();
          });
        }}
      >
        <option value="">enroll in…</option>
        {sequences.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.steps})
          </option>
        ))}
      </select>
      {message ? <span className="text-[11px] text-muted">{message}</span> : null}
    </div>
  );
}