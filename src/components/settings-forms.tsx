"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { resolveDupeAction, retryJobAction, runJobsNowAction, toggleRuleAction, updateWorkspaceAction } from "@/app/actions";
import {
  addCustomFieldAction,
  addRuleAction,
  createMemberAction,
  deleteRuleAction,
  reconnectSourceAction,
  setSourceCadenceAction,
} from "@/app/settings-actions";
import { Button, Icon } from "./ui";

/** shows what just happened, in one small line, then gets out of the way. */
function useFeedback() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const flash = (text: string, isError = false) => {
    if (isError) {
      setError(text);
      setMessage(null);
    } else {
      setMessage(text);
      setError(null);
    }
    setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 4000);
  };

  const run = (fn: () => Promise<{ ok?: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      flash(result.message ?? "done", result.ok === false);
      router.refresh();
    });

  return { message, error, pending, run };
}

function Feedback({ message, error }: { message: string | null; error: string | null }) {
  if (!message && !error) return null;
  return (
    <p className={`text-[11.5px] ${error ? "text-rose" : "text-green"}`} role="status">
      {error ?? message}
    </p>
  );
}

// ---------------------------------------------------------------- rules

export function RuleToggle({ ruleId, enabled }: { ruleId: string; enabled: boolean }) {
  const { message, error, pending, run } = useFeedback();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={pending}
        onClick={() => run(() => toggleRuleAction(ruleId, !enabled))}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-surface-3"}`}
        title={enabled ? "turn this rule off" : "turn this rule on"}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(20,20,30,0.25)] transition-[left] ${
            enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      <span className="text-[11.5px] text-muted">{enabled ? "on" : "off"}</span>
      <Feedback message={message} error={error} />
    </div>
  );
}

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const [confirming, setConfirming] = useState(false);
  const { message, error, pending, run } = useFeedback();
  if (!confirming) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setConfirming(true)} title="remove this rule">
        delete
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Button size="xs" variant="danger" disabled={pending} onClick={() => run(() => deleteRuleAction(ruleId))}>
        really delete
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
        keep it
      </Button>
      <Feedback message={message} error={error} />
    </div>
  );
}

const RULE_TRIGGERS: Array<{ value: string; label: string }> = [
  { value: "lead_created", label: "when a lead arrives" },
  { value: "reply_received", label: "when someone replies" },
  { value: "no_reply", label: "when nobody replies" },
  { value: "stage_changed", label: "when the stage changes" },
  { value: "meeting_booked", label: "when a meeting is booked" },
  { value: "task_overdue", label: "when a task runs late" },
  { value: "nurture_step_sent", label: "after a nurture step" },
];

export function AddRuleForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("lead_created");
  const [description, setDescription] = useState("");
  const { message, error, pending, run } = useFeedback();
  const firstRef = useRef<HTMLInputElement>(null);

  const save = () => {
    run(async () => {
      const result = await addRuleAction({ name, trigger_type: trigger, description });
      if (result.ok) {
        setName("");
        setDescription("");
        setOpen(false);
      }
      return result;
    });
  };

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        add rule
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">what is it called</span>
          <input
            ref={firstRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            placeholder="qualify every inbound lead"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">when should it run</span>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="field">
            {RULE_TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">what should it do (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
            placeholder="move them to to qualify and set a first follow-up"
          />
        </label>

        <Feedback message={message} error={error} />

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-faint">rules start switched off</p>
          <div className="flex gap-2">
            <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button size="xs" variant="primary" disabled={pending || !name.trim()} onClick={save}>
              {pending ? "saving…" : "add rule"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- team

export function AddMemberForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [title, setTitle] = useState("");
  const { message, error, pending, run } = useFeedback();
  const firstRef = useRef<HTMLInputElement>(null);

  const save = () =>
    run(async () => {
      const result = await createMemberAction({ name, email, role, title: title.trim() || null });
      if (result.ok) {
        setName("");
        setEmail("");
        setTitle("");
        setOpen(false);
      }
      return result;
    });

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        add teammate
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">their name</span>
          <input ref={firstRef} value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="sam osei" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">their email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="field" type="email" placeholder="sam@acme.com" />
        </label>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">what they do</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="account executive" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">what they can do</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="field">
              <option value="member">member — work on leads</option>
              <option value="admin">admin — change settings</option>
              <option value="owner">owner — everything</option>
            </select>
          </label>
        </div>

        <Feedback message={message} error={error} />

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-faint">they will see the same leads you do</p>
          <div className="flex gap-2">
            <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button size="xs" variant="primary" disabled={pending || !name.trim() || !email.trim()} onClick={save}>
              {pending ? "adding…" : "add them"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- custom fields

const FIELD_TYPES: Array<{ value: string; label: string }> = [
  { value: "text", label: "a short line" },
  { value: "long_text", label: "a longer note" },
  { value: "number", label: "a number" },
  { value: "date", label: "a date" },
  { value: "select", label: "pick one from a list" },
  { value: "url", label: "a link" },
  { value: "email", label: "an email" },
  { value: "boolean", label: "yes or no" },
];

export function AddCustomFieldForm() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [options, setOptions] = useState("");
  const { message, error, pending, run } = useFeedback();
  const firstRef = useRef<HTMLInputElement>(null);

  const save = () =>
    run(async () => {
      const result = await addCustomFieldAction({
        label,
        field_type: fieldType,
        options: options
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      });
      if (result.ok) {
        setLabel("");
        setOptions("");
        setOpen(false);
      }
      return result;
    });

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-3.5" />
        add field
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">what is it called</span>
          <input ref={firstRef} value={label} onChange={(e) => setLabel(e.target.value)} className="field" placeholder="budget" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">what kind of answer</span>
          <select value={fieldType} onChange={(e) => setFieldType(e.target.value)} className="field">
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {fieldType === "select" ? (
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">the choices, separated by commas</span>
            <input value={options} onChange={(e) => setOptions(e.target.value)} className="field" placeholder="under 1k, 1k to 10k, over 10k" />
          </label>
        ) : null}

        <Feedback message={message} error={error} />

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-faint">stays blank until you fill it in</p>
          <div className="flex gap-2">
            <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button size="xs" variant="primary" disabled={pending || !label.trim()} onClick={save}>
              {pending ? "saving…" : "add field"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- workspace

export interface WorkspaceShape {
  name: string;
  slug: string;
  timezone: string;
  week_starts_on: number;
  settings: Record<string, unknown>;
}

const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Lisbon",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const WEEKDAYS = [
  { value: 1, label: "monday" },
  { value: 0, label: "sunday" },
  { value: 6, label: "saturday" },
];

function workingHours(settings: Record<string, unknown>): { start: string; end: string; days: number[] } {
  const start = typeof settings.working_hours_start === "string" ? settings.working_hours_start : "09:00";
  const end = typeof settings.working_hours_end === "string" ? settings.working_hours_end : "17:30";
  const days = Array.isArray(settings.working_days) ? (settings.working_days as number[]).filter((d) => typeof d === "number") : [1, 2, 3, 4, 5];
  return { start, end, days: days.length ? days : [1, 2, 3, 4, 5] };
}

export function WorkspaceForm({ workspace }: { workspace: WorkspaceShape }) {
  const { message, error, pending, run } = useFeedback();
  const hours = workingHours(workspace.settings);
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [weekStart, setWeekStart] = useState(workspace.week_starts_on);
  const [start, setStart] = useState(hours.start);
  const [end, setEnd] = useState(hours.end);
  const [days, setDays] = useState<number[]>(hours.days);

  const toggleDay = (day: number) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));

  const save = () =>
    run(() =>
      updateWorkspaceAction({
        workspace_name: name,
        slug,
        timezone,
        week_starts_on: weekStart,
        working_hours_start: start,
        working_hours_end: end,
        working_days: days,
      }),
    );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">workspace name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="acme" />
          <span className="mt-1 block text-[11px] text-faint">this is the name at the top of your screen</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">short name</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value.replace(/\s+/g, "-").toLowerCase())} className="field" placeholder="acme" />
          <span className="mt-1 block text-[11px] text-faint">used in links. no spaces.</span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">your timezone</span>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="field">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.toLowerCase().replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">week starts on</span>
          <select value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))} className="field">
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-muted">working hours</span>
        <div className="flex flex-wrap items-center gap-2">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="field !w-auto" aria-label="day starts" />
          <span className="text-[12px] text-muted">to</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="field !w-auto" aria-label="day ends" />
          <div className="flex items-center gap-1">
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`grid size-7 place-items-center rounded-[7px] text-[11px] font-medium transition-colors ${
                  days.includes(d.value) ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-faint hover:text-ink"
                }`}
                title={d.label}
              >
                {d.label.slice(0, 2)}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">quiet hours stop reminders nudging you outside these times.</p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <Feedback message={message} error={error} />
        <Button variant="primary" size="sm" disabled={pending} onClick={save} className="ml-auto">
          {pending ? "saving…" : "save"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sources

const CADENCE: Array<{ value: number; label: string }> = [
  { value: 1, label: "every hour" },
  { value: 6, label: "every 6 hours" },
  { value: 12, label: "twice a day" },
  { value: 24, label: "every day" },
  { value: 72, label: "every 3 days" },
  { value: 168, label: "once a week" },
];

export function SourceRowControls({ sourceId, status, cadence }: { sourceId: string; status: string; cadence: number }) {
  const { message, error, pending, run } = useFeedback();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="field !w-auto !py-1 !text-[11.5px]"
        value={cadence}
        disabled={pending}
        onChange={(e) => run(() => setSourceCadenceAction(sourceId, Number(e.target.value)))}
        aria-label="how often to check"
      >
        {CADENCE.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      {status !== "connected" ? (
        <Button size="xs" disabled={pending} onClick={() => run(() => reconnectSourceAction(sourceId))}>
          reconnect
        </Button>
      ) : null}
      <Feedback message={message} error={error} />
    </div>
  );
}

// ---------------------------------------------------------------- jobs

export function RetryJobButton({ jobId }: { jobId: string }) {
  const { message, error, pending, run } = useFeedback();
  return (
    <div className="flex items-center gap-1.5">
      <Button size="xs" disabled={pending} onClick={() => run(() => retryJobAction(jobId))} title="put it back in the queue">
        retry
      </Button>
      <Feedback message={message} error={error} />
    </div>
  );
}

export function RunQueueButton() {
  const { message, error, pending, run } = useFeedback();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => runJobsNowAction())}>
        <Icon name="spark" className="size-3.5" />
        run the queue now
      </Button>
      <Feedback message={message} error={error} />
    </div>
  );
}

// ---------------------------------------------------------------- duplicates

export function DupeDecision({
  candidateId,
  action,
  label,
  variant = "secondary",
}: {
  candidateId: string;
  action: "merge" | "dismiss" | "link";
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const { message, error, pending, run } = useFeedback();
  return (
    <div className="flex items-center gap-1.5">
      <Button size="xs" variant={variant} disabled={pending} onClick={() => run(() => resolveDupeAction(candidateId, action))}>
        {pending ? "working…" : label}
      </Button>
      <Feedback message={message} error={error} />
    </div>
  );
}
