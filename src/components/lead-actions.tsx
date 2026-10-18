"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addNoteAction,
  archiveLeadAction,
  bookMeetingAction,
  createOpportunityAction,
  createTaskAction,
  enrollLeadAction,
  releaseStateAction,
  sendMessageAction,
  setNurtureStateAction,
  setOutreachStateAction,
  setStageAction,
  updateLeadAction,
  recordReplyAction,
} from "@/app/actions";
import { CHANNELS, CHANNEL_META } from "@/lib/domain";
import type { ActivityEvent } from "@/lib/types";
import { Badge, Button, Icon } from "./ui";

// ---------------------------------------------------------------- modal shell

function Modal({
  open,
  onClose,
  title,
  hint,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[9vh]">
      <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`slide-in panel relative w-full ${width} overflow-hidden !rounded-xl p-0 shadow-lg`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
            {hint ? <p className="mt-0.5 text-[11.5px] text-muted">{hint}</p> : null}
          </div>
          <button onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function useAction() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: (r: { ok: boolean; message?: string }) => void) => {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setMessage({ text: result.error ?? "that did not work", tone: "bad" });
        return;
      }
      setMessage({ text: result.message ?? "saved", tone: "good" });
      after?.(result);
      router.refresh();
    });
  };

  return { pending, message, setMessage, run };
}

// ---------------------------------------------------------------- header actions

export function LeadActions({
  leadId,
  archived,
  qualified,
  converted,
}: {
  leadId: string;
  archived: boolean;
  qualified: boolean;
  converted: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!qualified ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setStageAction(leadId, "qualified"))}
        >
          <Icon name="check" className="size-3.5" />
          qualify
        </Button>
      ) : null}
      {!converted ? (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setStageAction(leadId, "converted"))}>
          <Icon name="spark" className="size-3.5" />
          mark won
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => archiveLeadAction(leadId, !archived))}>
        {archived ? "restore" : "archive"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- state controls

export function LeadStateControls({
  leadId,
  axis,
  options,
  current,
}: {
  leadId: string;
  axis: "pipeline" | "outreach" | "nurture";
  options: Array<{ value: string; label: string }>;
  current: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const active = options.find((o) => o.value === current);

  const apply = (value: string) => {
    setOpen(false);
    if (value === current) return;
    if (axis === "pipeline") run(() => setStageAction(leadId, value as never));
    else if (axis === "outreach") run(() => setOutreachStateAction(leadId, value as never));
    else run(() => setNurtureStateAction(leadId, value as never));
  };

  return (
    <div className="relative mt-2 flex items-center gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-[6px] border border-line px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        change
        <Icon name="chevron" className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="slide-in absolute left-0 top-7 z-50 w-56 overflow-hidden rounded-[9px] border border-line bg-surface p-1 shadow-md">
            <p className="px-2 py-1.5 text-[10.5px] leading-snug text-faint">this pins the value. automation will leave it alone.</p>
            {options.map((o) => (
              <button
                key={o.value}
                disabled={pending}
                onClick={() => apply(o.value)}
                className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                  o.value === current ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === current ? <Icon name="check" className="size-3" /> : null}
              </button>
            ))}
            <div className="mt-1 border-t border-line pt-1">
              <button
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  run(() => releaseStateAction(leadId, axis));
                }}
                className="w-full rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-accent-ink hover:bg-surface-2"
              >
                let automation handle this again
              </button>
            </div>
          </div>
        </>
      ) : (
        <span className="truncate text-[11px] text-faint">{active?.label}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- identity form

export function LeadIdentityForm({ leadId, initial }: { leadId: string; initial: Record<string, string | null> }) {
  const { pending, message, run } = useAction();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const patch: Record<string, string | null> = {};
        for (const key of ["full_name", "email", "phone", "job_title", "company_name", "company_website", "linkedin_url", "x_url", "location", "industry", "company_size", "notes"]) {
          patch[key] = (form.get(key) as string) || null;
        }
        run(() => updateLeadAction(leadId, patch));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="full_name" label="full name" defaultValue={initial.full_name} />
        <Field name="job_title" label="job title" defaultValue={initial.job_title} />
        <Field name="email" label="email" type="email" defaultValue={initial.email} />
        <Field name="phone" label="phone" defaultValue={initial.phone} />
        <Field name="company_name" label="company name" defaultValue={initial.company_name} />
        <Field name="company_website" label="company website" defaultValue={initial.company_website} />
        <Field name="linkedin_url" label="linkedin" defaultValue={initial.linkedin_url} />
        <Field name="x_url" label="x / twitter" defaultValue={initial.x_url} />
        <Field name="location" label="location" defaultValue={initial.location} />
        <Field name="industry" label="industry" defaultValue={initial.industry} />
        <Field name="company_size" label="company size" defaultValue={initial.company_size} />
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">notes</span>
          <textarea name="notes" rows={4} defaultValue={initial.notes ?? ""} className="field resize-y" />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "saving…" : "save changes"}
        </Button>
        {message ? (
          <span className={`text-[12px] ${message.tone === "good" ? "text-green" : "text-rose"}`}>{message.text}</span>
        ) : null}
      </div>
    </form>
  );
}

function Field({ name, label, defaultValue, type = "text" }: { name: string; label: string; defaultValue?: string | null; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-muted">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} className="field" />
    </label>
  );
}

// ---------------------------------------------------------------- note

export function AddNoteForm({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { pending, run } = useAction();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        note
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="add a note" hint="goes on the record and the timeline.">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoFocus
          className="field resize-y"
          placeholder="what did you learn?"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={pending || !text.trim()}
            onClick={() =>
              run(() => addNoteAction(leadId, text), () => {
                setText("");
                setOpen(false);
              })
            }
          >
            {pending ? "saving…" : "add note"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- task

export function NewTaskForLead({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        task
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="add a task" hint={`something to do about ${leadName.split(" ")[0]}`}>
        <TaskFields
          pending={pending}
          submitLabel="add task"
          onSubmit={(values) =>
            run(() => createTaskAction({ ...values, lead_id: leadId, type: values.type as never, priority: values.priority as never }), () => setOpen(false))
          }
        />
      </Modal>
    </>
  );
}

function TaskFields({
  pending,
  submitLabel,
  onSubmit,
  leadId,
  defaultDue,
}: {
  pending: boolean;
  submitLabel: string;
  onSubmit: (v: { title: string; type: string; priority: string; due_at: string | null; description: string | null }) => void;
  leadId?: string;
  defaultDue?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("follow_up");
  const [priority, setPriority] = useState("medium");
  const [when, setWhen] = useState("");
  const [description, setDescription] = useState("");

  const due = useMemo(() => {
    if (!when) return null;
    if (when === "today") return new Date().toISOString().slice(0, 16);
    if (when === "tomorrow") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString().slice(0, 16);
    }
    if (when === "next week") {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d.toISOString().slice(0, 16);
    }
    return when;
  }, [when]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted">what needs doing</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="field" autoFocus placeholder="call them about the demo" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className="field">
            {["call", "email", "research", "follow_up", "meeting", "nurture", "other"].map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">how urgent</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="field">
            {["low", "medium", "high", "urgent"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">when</span>
          <select value={when} onChange={(e) => setWhen(e.target.value)} className="field">
            <option value="">no date</option>
            <option value="today">today</option>
            <option value="tomorrow">tomorrow</option>
            <option value="next week">next week</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted">notes</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="field resize-none" />
      </label>
      <div className="flex justify-end gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={pending || !title.trim()}
          onClick={() =>
            onSubmit({
              title,
              type,
              priority,
              due_at: due,
              description: description || null,
            })
          }
        >
          {pending ? "saving…" : submitLabel}
        </Button>
      </div>
      {leadId ? <input type="hidden" value={leadId} readOnly /> : null}
      {defaultDue ? <input type="hidden" value={defaultDue} readOnly /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- messages

export function LogMessage({ leadId, defaultChannel }: { leadId: string; defaultChannel?: string }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(defaultChannel ?? "email");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [outcome, setOutcome] = useState("connected");
  const [duration, setDuration] = useState("");
  const { pending, message, setMessage, run } = useAction();

  const isCall = channel === "phone";

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="mail" className="size-3.5" />
        {isCall ? "log a call" : "log outreach"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="record what went out"
        hint="sending this updates their outreach state on its own. it never counts as a reply."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {CHANNELS.map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                  channel === c ? "bg-accent-soft font-medium text-accent-ink" : "bg-surface-2 text-muted hover:text-ink"
                }`}
              >
                {CHANNEL_META[c].label}
              </button>
            ))}
          </div>

          {isCall ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">how did it go</span>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="field">
                  <option value="connected">we spoke</option>
                  <option value="missed">no answer</option>
                  <option value="voicemail">left a voicemail</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted">how long (minutes)</span>
                <input value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="field" placeholder="12" />
              </label>
            </div>
          ) : channel !== "form" && channel !== "meeting" ? (
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="field" placeholder="quick question about your team" />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">{isCall ? "what happened" : "the message"}</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="field resize-y"
              placeholder={isCall ? "talked about their current process, sending details" : "hi there…"}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">follow up in</span>
            <select value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="field">
              <option value="">nothing</option>
              <option value="3">3 days</option>
              <option value="5">5 days</option>
              <option value="7">a week</option>
              <option value="14">a fortnight</option>
              <option value="30">a month</option>
            </select>
          </label>

          {message ? <p className={`text-[12px] ${message.tone === "good" ? "text-green" : "text-rose"}`}>{message.text}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || (!content.trim() && !isCall)}
              onClick={() =>
                run(
                  () =>
                    sendMessageAction({
                      lead_id: leadId,
                      channel: channel as never,
                      subject: subject || null,
                      content: content || null,
                      follow_up_days: followUp ? Number(followUp) : null,
                      duration_seconds: duration ? Number(duration) * 60 : null,
                      call_outcome: isCall ? outcome : null,
                    }),
                  () => {
                    setContent("");
                    setSubject("");
                    setOpen(false);
                  },
                )
              }
            >
              {pending ? "saving…" : "save"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function LogReply({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const { pending, run } = useAction();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="chevron" className="size-3.5 rotate-180" />
        log a reply
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="they replied" hint="this is what moves them to replied or conversation active.">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          autoFocus
          className="field resize-y"
          placeholder="what they said…"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={pending || !content.trim()}
            onClick={() =>
              run(
                () => recordReplyAction({ lead_id: leadId, content, channel: "email" }),
                () => {
                  setContent("");
                  setOpen(false);
                },
              )
            }
          >
            {pending ? "saving…" : "save reply"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- meetings and deals

export function BookMeetingForm({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("intro call");
  const [when, setWhen] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const { pending, run } = useAction();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        book a meeting
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="book a meeting" hint={`a prep task for ${leadName.split(" ")[0]} gets created too`}>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">what kind</span>
            <select value={title} onChange={(e) => setTitle(e.target.value)} className="field">
              <option value="intro call">intro call</option>
              <option value="product walkthrough">product walkthrough</option>
              <option value="discovery call">discovery call</option>
              <option value="pricing chat">pricing chat</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">when</span>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="field" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">how long</span>
              <select value={minutes} onChange={(e) => setMinutes(e.target.value)} className="field">
                {["15", "30", "45", "60"].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">where</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="field" placeholder="zoom / their office" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">what to cover</span>
            <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={2} className="field resize-none" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || !when}
              onClick={() =>
                run(
                  () =>
                    bookMeetingAction({
                      lead_id: leadId,
                      title,
                      scheduled_at: new Date(when).toISOString(),
                      duration_minutes: Number(minutes),
                      location: location || null,
                      agenda: agenda || null,
                    }),
                  () => {
                    setWhen("");
                    setOpen(false);
                  },
                )
              }
            >
              {pending ? "saving…" : "book it"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function NewOpportunity({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("qualifying");
  const { pending, run } = useAction();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        new opportunity
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="new opportunity" hint="creating one moves them to the opportunity stage.">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">what are we selling</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="field" autoFocus placeholder="annual plan" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">value</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="field" placeholder="6000" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">stage</span>
              <select value={stage} onChange={(e) => setStage(e.target.value)} className="field">
                {["qualifying", "proposal", "negotiation", "won", "lost"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || !name.trim()}
              onClick={() =>
                run(
                  () => createOpportunityAction({ lead_id: leadId, name, amount: Number(amount || 0), stage }),
                  () => {
                    setName("");
                    setAmount("");
                    setOpen(false);
                  },
                )
              }
            >
              {pending ? "saving…" : "create"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- nurture

export function EnrollForm({ leadId, sequences, already }: { leadId: string; sequences: Array<{ id: string; name: string }>; already: string[] }) {
  const [open, setOpen] = useState(false);
  const [sequenceId, setSequenceId] = useState("");
  const [delay, setDelay] = useState("0");
  const { pending, message, run } = useAction();

  const available = sequences.filter((s) => !already.includes(s.id));

  return (
    <>
      <Button variant="secondary" size="sm" disabled={available.length === 0} onClick={() => setOpen(true)}>
        <Icon name="nurture" className="size-3.5" />
        add to a sequence
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="add to a sequence" hint="the steps get queued and sent by the background job.">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">which sequence</span>
            <select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className="field">
              <option value="">pick one</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">first step in</span>
            <select value={delay} onChange={(e) => setDelay(e.target.value)} className="field">
              <option value="0">straight away</option>
              <option value="1">tomorrow</option>
              <option value="3">in three days</option>
              <option value="7">next week</option>
            </select>
          </label>
          {message ? <p className={`text-[12px] ${message.tone === "good" ? "text-green" : "text-rose"}`}>{message.text}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || !sequenceId}
              onClick={() => run(() => enrollLeadAction(leadId, sequenceId, Number(delay)), () => setOpen(false))}
            >
              {pending ? "adding…" : "add them"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- timeline

const EVENT_GROUPS: Array<{ key: string; label: string; types: string[] }> = [
  { key: "everything", label: "everything", types: [] },
  { key: "messages", label: "messages", types: ["message_sent", "message_replied", "message_delivered", "message_opened", "message_failed", "call_logged"] },
  { key: "stages", label: "stages", types: ["stage_changed", "converted", "lead_created", "lead_merged", "outreach_state_changed", "nurture_state_changed"] },
  { key: "tasks", label: "tasks", types: ["task_created", "task_completed", "follow_up_due"] },
  { key: "meetings", label: "meetings", types: ["meeting_booked", "meeting_completed", "meeting_cancelled", "opportunity_created", "opportunity_won", "opportunity_lost"] },
  { key: "notes", label: "notes", types: ["note_added", "nurture_enrolled", "nurture_step_sent", "nurture_completed", "assigned"] },
];

const EVENT_DOT: Record<string, string> = {
  message_replied: "bg-green",
  converted: "bg-green",
  opportunity_won: "bg-green",
  message_sent: "bg-blue",
  message_delivered: "bg-blue",
  message_opened: "bg-cyan",
  message_failed: "bg-rose",
  opportunity_lost: "bg-rose",
  meeting_cancelled: "bg-rose",
  meeting_booked: "bg-amber",
  meeting_completed: "bg-amber",
  opportunity_created: "bg-amber",
  nurture_enrolled: "bg-violet",
  nurture_step_sent: "bg-violet",
  nurture_completed: "bg-violet",
  task_created: "bg-slate",
  task_completed: "bg-slate",
  call_logged: "bg-slate",
};

function eventTone(type: string): string {
  return EVENT_DOT[type] ?? "bg-slate";
}

function describe(event: ActivityEvent): string {
  switch (event.type) {
    case "lead_created":
      return "added to the workspace";
    case "lead_merged":
      return "a duplicate was folded into this record";
    case "stage_changed":
      return "pipeline stage moved";
    case "outreach_state_changed":
      return "outreach state changed by hand";
    case "nurture_state_changed":
      return "nurture state changed by hand";
    case "message_sent":
      return "we sent a message";
    case "message_replied":
      return "they replied";
    case "message_delivered":
      return "the message landed";
    case "message_opened":
      return "the message was opened";
    case "message_failed":
      return "the message did not send";
    case "call_logged":
      return "a call was logged";
    case "meeting_booked":
      return "a meeting was booked";
    case "meeting_completed":
      return "the meeting happened";
    case "opportunity_created":
      return "an opportunity was opened";
    case "opportunity_won":
      return "the deal was won";
    case "opportunity_lost":
      return "the deal was lost";
    case "converted":
      return "they became a customer";
    case "task_created":
      return "a task was added";
    case "task_completed":
      return "a task was finished";
    case "follow_up_due":
      return "a follow-up was scheduled";
    case "nurture_enrolled":
      return "added to a nurture sequence";
    case "nurture_step_sent":
      return "a nurture step went out";
    case "nurture_completed":
      return "the sequence finished";
    case "note_added":
      return "a note was added";
    case "assigned":
      return "the owner changed";
    default:
      return event.type.replaceAll("_", " ");
  }
}

export function TimelineFilter({ events }: { events: ActivityEvent[] }) {
  const [group, setGroup] = useState("everything");

  const shown = useMemo(() => {
    const active = EVENT_GROUPS.find((g) => g.key === group);
    if (!active || !active.types.length) return events;
    return events.filter((e) => active.types.includes(e.type));
  }, [events, group]);

  if (!events.length) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-[13px] text-ink">nothing has happened yet</p>
        <p className="mt-1 text-[12px] text-muted">log some outreach and it will show up here.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2.5">
        {EVENT_GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGroup(g.key)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
              group === g.key ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:bg-surface-2"
            }`}
          >
            {g.label}
          </button>
        ))}
        <span className="num ml-auto text-[11px] text-faint">
          {shown.length} {shown.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-muted">nothing of that kind on this record.</p>
      ) : (
        <ol className="relative px-4 py-3">
          {shown.map((event, i) => (
            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-1">
              {i < shown.length - 1 ? <span className="absolute left-[11px] top-6 h-[calc(100%-14px)] w-px bg-line" /> : null}
              <span className="relative z-10 mt-0.5 grid size-[23px] shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line">
                <span className={`size-1.5 rounded-full ${eventTone(event.type)}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[12.5px] text-ink">{describe(event)}</span>
                  {event.channel ? (
                    <Badge size="xs" tone={CHANNEL_META[event.channel as keyof typeof CHANNEL_META]?.tone ?? "slate"}>
                      {event.channel}
                    </Badge>
                  ) : null}
                  {event.direction ? (
                    <span className={`text-[10.5px] ${event.direction === "inbound" ? "text-green" : "text-faint"}`}>
                      {event.direction}
                    </span>
                  ) : null}
                </div>
                {event.summary ? <p className="mt-0.5 truncate text-[11.5px] text-muted">{event.summary}</p> : null}
                <p className="mt-0.5 text-[10.5px] text-faint">{new Date(event.occurred_at).toLocaleString("en-US", { timeZone: "UTC" })} utc</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
