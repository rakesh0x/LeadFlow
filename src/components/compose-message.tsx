"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { recordReplyAction, sendMessageAction } from "@/app/actions";
import { CHANNEL_META, CHANNELS, type Channel } from "@/lib/domain";
import { Button, Icon } from "./ui";

const FOLLOW_UP_DAYS = [3, 7, 14];
const SEND_CHANNELS = CHANNELS.filter((c) => c !== "meeting");

type Mode = "send" | "log_reply";

/**
 * one modal for writing to a lead, or for logging something that already happened.
 * used by outreach and follow-ups so a message is always logged the same way.
 */
export function ComposeMessage({
  leadId,
  leadName,
  channel = "email",
  replyToMessageId,
  subject: subjectPrefill = "",
  content: contentPrefill = "",
  mode: modePrefill = "send",
  campaignId = null,
  label = "write",
  icon,
  variant = "secondary",
  size = "xs",
  leads,
  onSaved,
}: {
  leadId?: string;
  leadName?: string;
  channel?: Channel;
  replyToMessageId?: string | null;
  subject?: string;
  content?: string;
  mode?: Mode;
  campaignId?: string | null;
  label?: string;
  icon?: "arrow" | "plus";
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "xs" | "sm" | "md";
  leads?: Array<{ id: string; name: string }>;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(modePrefill);
  const [pickedLead, setPickedLead] = useState(leadId ?? "");
  const [pickedChannel, setPickedChannel] = useState<Channel>(channel);
  const [followUp, setFollowUp] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => bodyRef.current?.focus(), 60);
  }, [open]);

  const submit = (formData: FormData) => {
    const target = pickedLead || leadId || "";
    if (!target) {
      setError("pick who this is for");
      return;
    }
    const subject = String(formData.get("subject") ?? "").trim();
    const content = String(formData.get("content") ?? "").trim();
    if (!subject && !content) {
      setError("there is nothing to send");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result =
        mode === "log_reply"
          ? await recordReplyAction({
              lead_id: target,
              channel: pickedChannel,
              subject: subject || null,
              content,
              in_reply_to: replyToMessageId ?? null,
            })
          : await sendMessageAction({
              lead_id: target,
              channel: pickedChannel,
              subject: subject || null,
              content: content || null,
              campaign_id: campaignId,
              follow_up_days: followUp,
              duration_seconds:
                pickedChannel === "phone" ? Number(formData.get("minutes") ?? 0) * 60 || null : null,
              call_outcome: pickedChannel === "phone" ? String(formData.get("outcome") ?? "connected") : null,
            });

      if (!result.ok) {
        setError(result.error ?? "that did not go through");
        return;
      }
      setOpen(false);
      setFollowUp(null);
      onSaved?.();
    });
  };

  const showSubject = pickedChannel === "email" || pickedChannel === "linkedin";

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} title={label}>
        {icon ? <Icon name={icon} className="size-3.5" /> : null}
        <span>{label}</span>
      </Button>

      {open ? (
        <ModalShell title={mode === "log_reply" ? "log what they said" : "write to them"} onClose={() => setOpen(false)}>
          <form action={submit} className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">who</span>
              {leadId ? (
                <span className="field block bg-surface-2 text-ink">{leadName ?? "this lead"}</span>
              ) : (
                <select name="lead_id" className="field" value={pickedLead} onChange={(e) => setPickedLead(e.target.value)} required>
                  <option value="">pick someone</option>
                  {(leads ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <div>
              <span className="mb-1 block text-[11.5px] font-medium text-muted">how</span>
              <div className="flex flex-wrap gap-1">
                {SEND_CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPickedChannel(c)}
                    className={`rounded-full px-2 py-1 text-[11.5px] transition-colors ${
                      pickedChannel === c ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:bg-surface-2"
                    }`}
                  >
                    {CHANNEL_META[c].label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "send" && leadId ? (
              <button
                type="button"
                onClick={() => setMode("log_reply")}
                className="rounded-full bg-surface-2 px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3"
              >
                actually, they got back to us
              </button>
            ) : null}

            {showSubject ? (
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">subject</span>
                <input name="subject" className="field" placeholder="what it is about" defaultValue={subjectPrefill} />
              </label>
            ) : null}

            {pickedChannel === "phone" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-muted">how it went</span>
                  <select name="outcome" className="field" defaultValue="connected">
                    <option value="connected">we spoke</option>
                    <option value="missed">no answer</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-muted">minutes</span>
                  <input name="minutes" type="number" min={0} max={600} defaultValue={0} className="field" />
                </label>
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">
                {mode === "log_reply" ? "what they wrote" : pickedChannel === "phone" ? "what you talked about" : "what you want to say"}
              </span>
              <textarea
                ref={bodyRef}
                name="content"
                rows={5}
                className="field resize-none"
                placeholder={mode === "log_reply" ? "their words, as close as you remember" : "short and plain is best"}
                defaultValue={contentPrefill}
              />
            </label>

            {mode === "send" ? (
              <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                <input
                  type="checkbox"
                  checked={followUp !== null}
                  onChange={(e) => setFollowUp(e.target.checked ? 7 : null)}
                  className="size-3.5 accent-[var(--accent)]"
                />
                remind us to follow up in
                <select
                  className="rounded-[6px] border border-line-strong bg-surface px-1.5 py-0.5 text-[12px]"
                  value={followUp ?? 7}
                  onChange={(e) => setFollowUp(Number(e.target.value))}
                  disabled={followUp === null}
                >
                  {FOLLOW_UP_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {error ? <p className="text-[12px] text-rose">{error}</p> : null}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11.5px] text-faint">
                {mode === "log_reply" ? "this counts as a reply from them" : "it gets logged against the lead"}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={pending}>
                  {pending ? "saving…" : mode === "log_reply" ? "save reply" : "log it"}
                </Button>
              </div>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

/** the calls tab needs a way to log a call against anyone in the workspace. */
export function LogCallButton({
  leads,
  leadId,
  leadName,
}: {
  leads: Array<{ id: string; name: string }>;
  leadId?: string;
  leadName?: string;
}) {
  return (
    <ComposeMessage
      leadId={leadId}
      leadName={leadName}
      leads={leads}
      channel="phone"
      label="log a call"
      icon="arrow"
      variant="primary"
      size="sm"
    />
  );
}

/** the frame every modal in the app uses. */
export function ModalShell({
  title,
  children,
  onClose,
  width = "max-w-lg",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[8vh]">
      <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`slide-in panel relative w-full ${width} overflow-hidden !rounded-xl p-0 shadow-lg`}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          <button onClick={onClose} className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
