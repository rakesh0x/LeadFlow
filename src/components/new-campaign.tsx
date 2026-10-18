"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction } from "@/app/actions";
import { CHANNEL_META, CHANNELS, type Channel } from "@/lib/domain";
import { Button, Icon } from "./ui";
import { ModalShell } from "./compose-message";

const STATUSES = ["draft", "active", "paused"] as const;

/** a new campaign. drafts by default so nothing goes out without you saying so. */
export function NewCampaign({ label = "new campaign", variant = "primary", size = "sm" }: { label?: string; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("email");
  const router = useRouter();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createCampaignAction({
        name: String(formData.get("name") ?? ""),
        channel,
        description: (formData.get("description") as string) || null,
        status: (formData.get("status") as string) || "draft",
      });
      if (!result.ok) {
        setError(result.error ?? "could not save that");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        <span>{label}</span>
      </Button>

      {open ? (
        <ModalShell title="a new campaign" onClose={() => setOpen(false)}>
          <form action={submit} className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">
                name <span className="text-rose">*</span>
              </span>
              <input name="name" className="field" placeholder="march outreach" required autoFocus />
            </label>

            <div>
              <span className="mb-1 block text-[11.5px] font-medium text-muted">how we will reach them</span>
              <div className="flex flex-wrap gap-1">
                {CHANNELS.filter((c) => c !== "meeting").map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChannel(c)}
                    className={`rounded-full px-2 py-1 text-[11.5px] transition-colors ${
                      channel === c ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:bg-surface-2"
                    }`}
                  >
                    {CHANNEL_META[c].label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">where it starts</span>
              <select name="status" className="field" defaultValue="draft">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">what it is for</span>
              <textarea name="description" rows={2} className="field resize-none" placeholder="who we are trying to reach" />
            </label>

            {error ? <p className="text-[12px] text-rose">{error}</p> : null}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11.5px] text-faint">you can start it whenever you like</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={pending}>
                  {pending ? "saving…" : "create it"}
                </Button>
              </div>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}
