import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { humanize } from "@/lib/db/time";
import { listSequences, nurtureBoard, sequenceStats, type NurtureBoardRow, type SequenceStep } from "@/lib/queries/nurture";
import { NURTURE_STATE_META } from "@/lib/domain";
import { Avatar, Badge, Card, CardHeader, EmptyState, Icon, Progress, StateBadge } from "@/components/ui";
import { PageHeader, Tabs } from "@/components/app-shell";
import { EnrollActions, EnrollSelect } from "@/components/enroll-actions";
import { NewSequenceButton } from "@/components/new-sequence";

export const dynamic = "force-dynamic";

const VIEWS = ["all", "nurturing", "not-enrolled", "reengage", "paused", "completed", "sequences"] as const;
type View = (typeof VIEWS)[number];

const VIEW_STATE: Partial<Record<View, string>> = {
  nurturing: "nurturing",
  "not-enrolled": "not_enrolled",
  reengage: "ready_for_reengagement",
  paused: "nurture_paused",
  completed: "nurture_completed",
};

const EMPTY_COPY: Record<string, { title: string; hint: string }> = {
  nurturing: { title: "nobody is mid-sequence right now", hint: "pick someone on the left and put them into a sequence." },
  "not-enrolled": { title: "everyone is in something", hint: "no prospect is sitting outside a sequence." },
  reengage: { title: "nothing needs another look", hint: "no sequence has run out quietly." },
  paused: { title: "nothing is on hold", hint: "every sequence that is running is running." },
  completed: { title: "no sequences finished yet", hint: "once one runs out of steps it shows up here." },
};

export default async function NurturePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const view = (VIEWS as readonly string[]).includes(params.view ?? "") ? (params.view as View) : "all";

  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const stats = sequenceStats(workspaceId, database);
  const board = nurtureBoard(workspaceId, database);
  const sequences = listSequences(workspaceId, database);

  const withSteps = sequences.map((s) => ({ sequence: s, steps: parseSteps(s.steps_json) }));
  const enrollable = withSteps.filter((s) => s.steps.length).map((s) => ({ id: s.sequence.id, name: s.sequence.name, steps: s.steps.length }));

  const rows = view === "all" ? board : board.filter((r) => r.nurture_state === VIEW_STATE[view]);

  const count = (state: string) => board.filter((r) => r.nurture_state === state).length;
  const tabs = [
    { label: "all", value: "all", count: board.length },
    { label: "nurturing", value: "nurturing", count: count("nurturing") },
    { label: "not enrolled", value: "not-enrolled", count: count("not_enrolled") },
    { label: "re-engage", value: "reengage", count: count("ready_for_reengagement") },
    { label: "paused", value: "paused", count: count("nurture_paused") },
    { label: "completed", value: "completed", count: count("nurture_completed") },
    { label: "sequences", value: "sequences", count: sequences.length },
  ];

  return (
    <div>
      <PageHeader
        title="nurture"
        hint="prospects being developed over time. a sequence is a short run of messages with a wait in between each one, so nobody gets chased."
        actions={view === "sequences" ? <NewSequenceButton /> : undefined}
        tabs={<Tabs items={tabs} active={view} basePath="/nurture" />}
      />

      {/* ---- where everyone sits, as five numbers you can click ---- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="nurturing" value={stats.nurturing ?? 0} href="/nurture?view=nurturing" tone="var(--violet)" sub="in an active sequence" />
        <Tile label="ready to re-engage" value={stats.reengage ?? 0} href="/nurture?view=reengage" tone="var(--cyan)" sub="went quiet, worth a nudge" />
        <Tile label="paused" value={stats.paused ?? 0} href="/nurture?view=paused" tone="var(--amber)" sub="holding, will pick back up" />
        <Tile label="completed" value={stats.completed ?? 0} href="/nurture?view=completed" tone="var(--green)" sub="ran out of steps" />
        <Tile label="never enrolled" value={stats.not_enrolled ?? 0} href="/nurture?view=not-enrolled" tone="var(--slate)" sub="not in any sequence" />
      </div>

      {view === "sequences" ? (
        <SequencesView withSteps={withSteps} />
      ) : (
        <Card className="mt-4" padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{tabTitle(view)}</h2>
              <p className="mt-0.5 text-[12px] text-muted">{tabHint(view, rows.length)}</p>
            </div>
            <Link href="/nurture?view=sequences" className="text-[12px] text-accent-ink hover:underline">
              manage sequences
            </Link>
          </div>

          <div className="hidden items-center gap-3 border-b border-line bg-surface-2/50 px-4 py-2 lg:flex">
            <span className="min-w-0 flex-[1.7] text-[11px] font-medium uppercase tracking-wide text-faint">lead</span>
            <span className="w-[104px] shrink-0 text-[11px] font-medium uppercase tracking-wide text-faint">state</span>
            <span className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-faint">sequence</span>
            <span className="w-[132px] shrink-0 text-[11px] font-medium uppercase tracking-wide text-faint">progress</span>
            <span className="w-[124px] shrink-0 text-[11px] font-medium uppercase tracking-wide text-faint">next step</span>
            <span className="w-[52px] shrink-0 text-right text-[11px] font-medium uppercase tracking-wide text-faint">replies</span>
            <span className="w-[104px] shrink-0 text-right text-[11px] font-medium uppercase tracking-wide text-faint">actions</span>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={view === "all" ? "no prospects here yet" : EMPTY_COPY[view].title}
              hint={view === "all" ? "add some leads and they will show up on this list." : EMPTY_COPY[view].hint}
              icon={<Icon name="nurture" className="size-5" />}
              action={
                <Link href="/generate" className="text-[12.5px] text-accent-ink hover:underline">
                  find some leads →
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <NurtureLine key={`${row.lead_id}-${row.enrollment_id ?? "none"}`} row={row} enrollable={enrollable} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Explainer />
    </div>
  );
}

// ---------------------------------------------------------------- the table

function NurtureLine({ row, enrollable }: { row: NurtureBoardRow; enrollable: Array<{ id: string; name: string; steps: number }> }) {
  const meta = NURTURE_STATE_META[row.nurture_state as "nurture_completed"] ?? NURTURE_STATE_META.not_enrolled;
  const current = row.current_step ?? 0;
  const total = row.total_steps ?? 0;
  const pct = total > 0 ? Math.round((Math.min(current, total) / total) * 100) : 0;
  const due = dueLabel(row);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors hover:bg-surface-2/40 lg:flex-nowrap">
      <span className="flex w-full min-w-0 items-center gap-2.5 lg:w-auto lg:flex-[1.7]">
        <Avatar name={row.full_name} size={28} />
        <span className="min-w-0 flex-1">
          <Link href={`/leads/${row.lead_id}`} className="block truncate text-[12.5px] text-ink hover:underline">
            {row.full_name}
          </Link>
          <span className="block truncate text-[11px] text-muted">{row.company_name ?? row.email ?? "no company"}</span>
        </span>
      </span>

      <span className="w-[104px] shrink-0">
        <StateBadge meta={meta} size="xs" />
      </span>

      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{row.sequence_name ?? <span className="text-faint">—</span>}</span>

      <span className="w-[132px] shrink-0">
        {total > 0 ? (
          <span className="block">
            <Progress value={pct} tone={row.state === "paused" ? "amber" : "violet"} />
            <span className="mt-1 block text-[10.5px] text-faint">
              step {Math.min(current + (row.state === "active" ? 1 : 0), total)} of {total}
            </span>
          </span>
        ) : (
          <span className="text-[11.5px] text-faint">—</span>
        )}
      </span>

      <span className="w-[124px] shrink-0">
        {due ? (
          <span className={`text-[11.5px] ${due.late ? "text-rose" : "text-muted"}`}>{due.text}</span>
        ) : (
          <span className="text-[11.5px] text-faint">—</span>
        )}
        <span className="mt-0.5 block text-[10.5px] text-faint">
          {row.last_activity_at ? `active ${humanize(row.last_activity_at)}` : "no activity yet"}
        </span>
      </span>

      <span className="w-[52px] shrink-0 text-right">
        <span className="num text-[12px] text-ink">{row.reply_count || 0}</span>
      </span>

      <span className="ml-auto inline-flex w-full shrink-0 justify-end lg:w-[104px]">
        {row.enrollment_id ? (
          <EnrollActions
            enrollmentId={row.enrollment_id}
            paused={row.state === "paused"}
            finished={row.state === "completed" || row.nurture_state === "nurture_completed"}
          />
        ) : (
          <EnrollSelect leadId={row.lead_id} sequences={enrollable} />
        )}
      </span>
    </li>
  );
}

function dueLabel(row: NurtureBoardRow): { text: string; late: boolean } | null {
  if (row.state === "paused") return { text: "on hold", late: false };
  if (!row.next_step_at) return null;
  const ms = new Date(row.next_step_at).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} late`, late: true };
  if (days === 0) return { text: "later today", late: false };
  return { text: `in ${days} ${days === 1 ? "day" : "days"}`, late: false };
}

// ---------------------------------------------------------------- sequences

function SequencesView({
  withSteps,
}: {
  withSteps: Array<{ sequence: ReturnType<typeof listSequences>[number]; steps: SequenceStep[] }>;
}) {
  if (!withSteps.length) {
    return (
      <Card className="mt-4" padded={false}>
        <EmptyState
          title="no sequences yet"
          hint="a sequence is just a few short messages with a wait in between. build your first one and enrol someone in it."
          icon={<Icon name="nurture" className="size-5" />}
        />
      </Card>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {withSteps.map(({ sequence, steps }) => (
        <Card key={sequence.id} padded={false}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3.5 hover:bg-surface-2/50">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{sequence.name}</h2>
                  <Badge tone={sequence.status === "active" ? "green" : sequence.status === "paused" ? "amber" : "slate"} size="xs" dot>
                    {sequence.status}
                  </Badge>
                </div>
                {(sequence.goal || sequence.description) ? (
                  <p className="mt-0.5 text-[12px] text-muted">{sequence.goal ?? sequence.description}</p>
                ) : null}
              </div>
              <Icon name="chevron" className="mt-0.5 size-3.5 shrink-0 text-faint transition-transform group-open:rotate-90" />
            </summary>

            <div className="grid grid-cols-3 gap-2 border-y border-line bg-surface-2/40 px-4 py-2.5 text-center">
              <Number label="steps" value={steps.length} />
              <Number label="in it now" value={sequence.active_enrollments} />
              <Number label="ever enrolled" value={sequence.total_enrollments} />
            </div>

            <div className="px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">what actually goes out</p>
              {steps.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted">
                  this one has no steps yet. nobody can be enrolled until it has at least one.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {steps.map((step, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent-ink">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{step.subject || step.name || `step ${i + 1}`}</span>
                        <span className="mt-0.5 block text-[11px] text-muted">
                          {step.channel ?? "email"}
                          {step.waitDays ? ` · waits ${step.waitDays} ${step.waitDays === 1 ? "day" : "days"} before the next one` : " · goes straight away"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-[11px] text-faint">{sequence.steps_sent} steps sent so far across everyone in this sequence.</p>
            </div>
          </details>
        </Card>
      ))}
    </div>
  );
}

function Number({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="num text-[17px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</div>
      <div className="mt-1 text-[10.5px] text-faint">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------- bits and pieces

function Explainer() {
  return (
    <Card className="mt-4">
      <CardHeader title="how this actually works" hint="so nothing here surprises you" />
      <div className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-muted">
        <p>
          a sequence is a handful of short messages with a wait in between each one. you enrol a person, the steps line up on
          a calendar, and they go out one at a time unless you pause them.
        </p>
        <p>
          the sending happens on the server, in the background. your browser never has to stay open and nothing is tied to
          whoever happens to be logged in when you set it up. if you pause someone, their remaining steps sit still until you
          pick them back up.
        </p>
        <p>
          when a sequence runs out, the person lands in <Link href="/nurture?view=reengage" className="text-accent-ink hover:underline">re-engagement</Link>{" "}
          if nothing else has happened. that is your cue to write something human, or enrol them in something else.
        </p>
      </div>
    </Card>
  );
}

function Tile({ label, value, href, sub, tone }: { label: string; value: number; href: string; sub: string; tone: string }) {
  return (
    <Link href={href} className="panel block p-3 transition-shadow hover:shadow-sm">
      <span className="block text-[11.5px] leading-tight text-muted">{label}</span>
      <span className="num mt-1.5 block text-[26px] font-semibold leading-none tracking-[-0.035em]" style={{ color: tone }}>
        {value}
      </span>
      <span className="mt-1.5 block truncate text-[11px] text-faint">{sub}</span>
    </Link>
  );
}

function parseSteps(json: string): SequenceStep[] {
  try {
    const parsed = JSON.parse(json) as SequenceStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tabTitle(view: View): string {
  switch (view) {
    case "nurturing":
      return "in a sequence right now";
    case "not-enrolled":
      return "never been enrolled";
    case "reengage":
      return "ready for another look";
    case "paused":
      return "on hold";
    case "completed":
      return "finished their sequence";
    default:
      return "every prospect";
  }
}

function tabHint(view: View, n: number): string {
  if (view === "all") return `${n} people we are working, in whatever state they sit in`;
  return `${n} ${n === 1 ? "person" : "people"}`;
}