import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { getLeadDetail } from "@/lib/queries/leads";
import { sequenceSteps } from "@/lib/queries/nurture";
import { humanize, formatDate, formatDateTime, nowIso } from "@/lib/db/time";
import {
  CHANNEL_META,
  DELIVERY_META,
  NURTURE_STATE_META,
  OUTREACH_STATE_META,
  PIPELINE_STAGE_META,
  PRIORITY_META,
  TASK_TYPE_META,
  SOURCE_KIND_META,
} from "@/lib/domain";
import type { ActivityEvent, Message } from "@/lib/types";
import { Avatar, Badge, Button, Card, CardHeader, Divider, EmptyState, Icon, KeyValue, Progress } from "@/components/ui";
import { TaskTick } from "@/components/task-tick";
import { LeadActions, LeadStateControls, LeadIdentityForm, AddNoteForm, NewTaskForLead, LogMessage, LogReply, BookMeetingForm, NewOpportunity, EnrollForm, TimelineFilter } from "@/components/lead-actions";

export const dynamic = "force-dynamic";

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const detail = getLeadDetail(database, workspaceId, id);
  if (!detail) notFound();

  const { lead, events, messages, tasks, meetings, opportunities, enrollments, attributions, links, merges, owners } = detail;

  const now = nowIso();
  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const overdue = openTasks.filter((t) => t.due_at && t.due_at < now);
  const nextTask = openTasks.find((t) => t.due_at && t.due_at <= now) ?? openTasks[0] ?? null;
  const lastOutbound = messages.find((m) => m.direction === "outbound");
  const daysSinceOutbound = lastOutbound?.sent_at ? Math.floor((Date.now() - new Date(lastOutbound.sent_at).getTime()) / 86_400_000) : null;

  const sequences = database
    .prepare(`SELECT id, name FROM nurture_sequences WHERE workspace_id = ? AND status = 'active' ORDER BY name`)
    .all(workspaceId) as Array<{ id: string; name: string }>;

  const activeTab = tab ?? "timeline";

  const tabs = [
    { key: "timeline", label: "timeline" },
    { key: "messages", label: "messages", count: messages.length },
    { key: "tasks", label: "tasks", count: openTasks.length },
    { key: "deals", label: "meetings and deals", count: meetings.length + opportunities.length },
    { key: "nurture", label: "nurture", count: enrollments.length },
    { key: "details", label: "details" },
  ];

  return (
    <div className="pb-10">
      {/* ------------------------------------------------------------ header */}
      <div className="mb-4 flex flex-wrap items-start gap-4">
        <Avatar name={lead.full_name} hue={lead.owner_hue ?? undefined} size={52} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-ink">{lead.full_name}</h1>
            {lead.is_new === 1 && lead.first_touched_at === null ? (
              <Badge tone="amber" size="xs">
                not looked at yet
              </Badge>
            ) : null}
            {lead.job_title ? <span className="text-[13px] text-muted">· {lead.job_title}</span> : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            {lead.company_name ? (
              lead.company_domain ? (
                <a href={`https://${lead.company_domain}`} target="_blank" rel="noreferrer noopener" className="link">
                  {lead.company_name}
                </a>
              ) : (
                <span>{lead.company_name}</span>
              )
            ) : null}
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="link">
                {lead.email}
              </a>
            ) : null}
            {lead.phone ? <span>{lead.phone}</span> : null}
            {lead.location ? <span>{lead.location}</span> : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-faint">
            <span>added {formatDate(lead.created_at)}</span>
            <span>·</span>
            <span>last activity {humanize(lead.last_activity_at ?? lead.created_at)}</span>
            {lead.owner_name ? (
              <>
                <span>·</span>
                <span>owned by {lead.owner_name}</span>
              </>
            ) : null}
          </div>
        </div>

        <LeadActions
          leadId={lead.id}
          archived={lead.is_archived === 1}
          qualified={lead.pipeline_stage === "qualified" || lead.pipeline_stage === "converted"}
          converted={lead.pipeline_stage === "converted"}
        />
      </div>

      {/* ------------------------------------------------------------ state strip */}
      <Card className="mb-4">
        <div className="grid gap-4 md:grid-cols-3">
          <LeadStateControl
            axis="pipeline"
            label="pipeline stage"
            hint={PIPELINE_STAGE_META[lead.pipeline_stage].hint}
            current={lead.pipeline_stage}
            options={Object.entries(PIPELINE_STAGE_META).map(([value, meta]) => ({ value, label: meta.label, tone: meta.tone }))}
            pinned={lead.pipeline_stage_set_by === "manual"}
            leadId={lead.id}
          />
          <LeadStateControl
            axis="outreach"
            label="outreach state"
            hint={OUTREACH_STATE_META[lead.outreach_state].hint}
            current={lead.outreach_state}
            options={Object.entries(OUTREACH_STATE_META).map(([value, meta]) => ({ value, label: meta.label, tone: meta.tone }))}
            pinned={lead.outreach_state_set_by === "manual"}
            leadId={lead.id}
          />
          <LeadStateControl
            axis="nurture"
            label="nurture state"
            hint={NURTURE_STATE_META[lead.nurture_state].hint}
            current={lead.nurture_state}
            options={Object.entries(NURTURE_STATE_META).map(([value, meta]) => ({ value, label: meta.label, tone: meta.tone }))}
            pinned={lead.nurture_state_set_by === "manual"}
            leadId={lead.id}
          />
        </div>

        <Divider className="my-3.5" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="text-faint">messages out</span>
              <span className="num text-ink">{lead.outbound_count}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-faint">replies in</span>
              <span className="num text-ink">{lead.reply_count}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-faint">meetings</span>
              <span className="num text-ink">{lead.meeting_count}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-faint">open tasks</span>
              <span className={`num ${overdue.length ? "text-rose" : "text-ink"}`}>{openTasks.length}</span>
            </span>
            {lead.score ? (
              <span className="flex items-center gap-1.5">
                <span className="text-faint">score</span>
                <span className="num text-ink">{lead.score}</span>
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LogMessage leadId={lead.id} defaultChannel={lastOutbound?.channel ?? "email"} />
            <LogReply leadId={lead.id} />
            <NewTaskForLead leadId={lead.id} leadName={lead.full_name} />
            <Button variant="primary" size="sm" href={`/tasks?lead=${lead.id}`}>
              <Icon name="tasks" className="size-3.5" />
              tasks
            </Button>
          </div>
        </div>

        {nextTask ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-[8px] border border-line bg-surface-2/60 px-3 py-2">
            <TaskTick taskId={nextTask.id} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
              next thing: {nextTask.title}
              <span className={`ml-2 ${nextTask.due_at && nextTask.due_at < now ? "text-rose" : "text-faint"}`}>
                {nextTask.due_at ? humanize(nextTask.due_at) : "no due date"}
              </span>
            </span>
            <Badge tone={PRIORITY_META[nextTask.priority].tone} size="xs">
              {PRIORITY_META[nextTask.priority].label}
            </Badge>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------ tabs */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/leads/${lead.id}?tab=${t.key}`}
            className={`-mb-px border-b-2 px-2.5 pb-2 pt-1.5 text-[12.5px] transition-colors ${
              activeTab === t.key ? "border-accent font-medium text-accent-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count ? <span className="num ml-1.5 text-[11px] text-faint">{t.count}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* ---------------------------------------------------- timeline */}
          {activeTab === "timeline" ? (
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-[13.5px] font-semibold">everything that has happened</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    this is the record the workspace reads. every state above comes from here.
                  </p>
                </div>
                <AddNoteForm leadId={lead.id} />
              </div>
              <TimelineFilter events={events} />
            </Card>
          ) : null}

          {/* ---------------------------------------------------- messages */}
          {activeTab === "messages" ? (
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-[13.5px] font-semibold">messages</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    everything sent and received, across every channel.
                    {daysSinceOutbound !== null ? ` nothing back in ${daysSinceOutbound} days.` : " nothing sent yet."}
                  </p>
                </div>
              </div>
              {messages.length === 0 ? (
                <EmptyState title="nothing sent yet" hint="log your first message and the outreach state will update on its own." />
              ) : (
                <ul className="divide-y divide-line">
                  {messages.map((m) => (
                    <MessageRow key={m.id} message={m} />
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {/* ---------------------------------------------------- tasks */}
          {activeTab === "tasks" ? (
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-[13.5px] font-semibold">tasks for {lead.full_name.split(" ")[0]}</h2>
                  <p className="mt-0.5 text-[12px] text-muted">finishing one adds it to the timeline and refreshes their state.</p>
                </div>
                <NewTaskForLead leadId={lead.id} leadName={lead.full_name} />
              </div>
              {tasks.length === 0 ? (
                <EmptyState title="nothing to do here" hint="add a task so it does not get forgotten." />
              ) : (
                <ul className="divide-y divide-line">
                  {tasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                      <TaskTick taskId={task.id} done={task.status === "completed"} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[12.5px] ${task.status === "completed" ? "text-faint line-through" : "text-ink"}`}>
                          {task.title}
                        </span>
                        {task.description ? <span className="mt-0.5 block truncate text-[11px] text-muted">{task.description}</span> : null}
                      </span>
                      <Badge tone={TASK_TYPE_META[task.type].tone} size="xs">
                        {TASK_TYPE_META[task.type].label}
                      </Badge>
                      <Badge tone={PRIORITY_META[task.priority].tone} size="xs">
                        {PRIORITY_META[task.priority].label}
                      </Badge>
                      <span className={`w-24 shrink-0 text-right text-[11px] ${task.due_at && task.due_at < now && task.status !== "completed" ? "text-rose" : "text-faint"}`}>
                        {task.status === "completed" ? `done ${humanize(task.completed_at)}` : task.due_at ? humanize(task.due_at) : "no date"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {/* ---------------------------------------------------- deals */}
          {activeTab === "deals" ? (
            <>
              <Card padded={false}>
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div>
                    <h2 className="text-[13.5px] font-semibold">meetings</h2>
                    <p className="mt-0.5 text-[12px] text-muted">booked calls and what came out of them.</p>
                  </div>
                  <BookMeetingForm leadId={lead.id} leadName={lead.full_name} />
                </div>
                {meetings.length === 0 ? (
                  <EmptyState title="no meetings yet" hint="book one and their pipeline stage moves to meeting booked." />
                ) : (
                  <ul className="divide-y divide-line">
                    {meetings.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-amber-soft text-amber">
                          <Icon name="clock" className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{m.title}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {m.scheduled_at ? formatDateTime(m.scheduled_at) : "no time set"} · {m.duration_minutes} min
                            {m.outcome ? ` · ${m.outcome}` : ""}
                          </span>
                        </span>
                        <Badge tone={m.status === "completed" ? "green" : m.status === "no_show" ? "rose" : m.status === "cancelled" ? "stone" : "amber"} size="xs">
                          {m.status.replaceAll("_", " ")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card padded={false}>
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div>
                    <h2 className="text-[13.5px] font-semibold">opportunities</h2>
                    <p className="mt-0.5 text-[12px] text-muted">deals in progress and what they came to.</p>
                  </div>
                  <NewOpportunity leadId={lead.id} />
                </div>
                {opportunities.length === 0 ? (
                  <EmptyState title="no opportunities yet" hint="create one when you are working a real deal." />
                ) : (
                  <ul className="divide-y divide-line">
                    {opportunities.map((o) => (
                      <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{o.name}</span>
                          <span className="block text-[11px] text-muted">
                            {o.stage} · created {formatDate(o.created_at)}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12.5px] num text-ink">
                          {o.currency.toUpperCase()} {o.amount.toLocaleString()}
                        </span>
                        <Badge tone={o.stage === "won" ? "green" : o.stage === "lost" ? "rose" : "amber"} size="xs">
                          {o.stage}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : null}

          {/* ---------------------------------------------------- nurture */}
          {activeTab === "nurture" ? (
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-[13.5px] font-semibold">nurture</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    sequences run on the server in the background, so they keep going whether or not anyone has this open.
                  </p>
                </div>
                <EnrollForm leadId={lead.id} sequences={sequences} already={enrollments.map((e) => e.sequence_id)} />
              </div>
              {enrollments.length === 0 ? (
                <EmptyState
                  title="not in any sequence"
                  hint="adding them to a sequence is how we keep developing them without you having to remember."
                  icon={<Icon name="nurture" className="size-5" />}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {enrollments.map((e) => {
                    const steps = sequenceSteps(database, e.id);
                    const done = steps.filter((s) => s.status === "sent" || s.status === "replied").length;
                    return (
                      <li key={e.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-ink">{e.sequence_name}</span>
                            <span className="block text-[11px] text-muted">
                              step {Math.min(e.current_step + 1, e.total_steps)} of {e.total_steps} ·{" "}
                              {e.next_step_at ? `next ${humanize(e.next_step_at)}` : "nothing queued"}
                            </span>
                          </span>
                          <Badge tone={NURTURE_STATE_META[lead.nurture_state].tone} size="xs">
                            {NURTURE_STATE_META[lead.nurture_state].label}
                          </Badge>
                        </div>
                        <Progress className="mt-2" value={e.total_steps ? (done / e.total_steps) * 100 : 0} tone="violet" />
                        <ol className="mt-2.5 space-y-1">
                          {steps.map((step) => (
                            <li key={step.id} className="flex items-center gap-2 text-[11.5px]">
                              <span
                                className={`size-1.5 shrink-0 rounded-full ${
                                  step.status === "sent" || step.status === "replied" ? "bg-green" : step.status === "failed" ? "bg-rose" : "bg-line-strong"
                                }`}
                              />
                              <span className={`truncate ${step.status === "sent" ? "text-muted" : "text-ink-2"}`}>{step.subject}</span>
                              <span className="ml-auto shrink-0 text-faint">
                                {step.status === "sent" ? humanize(step.sent_at) : step.scheduled_at ? humanize(step.scheduled_at) : ""}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : null}

          {/* ---------------------------------------------------- details */}
          {activeTab === "details" ? (
            <Card>
              <CardHeader
                title="everything we know"
                hint="editing these writes to the record and adds an entry to the timeline."
              />
              <div className="mt-4">
                <LeadIdentityForm
                  leadId={lead.id}
                  initial={{
                    full_name: lead.full_name,
                    email: lead.email,
                    phone: lead.phone,
                    job_title: lead.job_title,
                    company_name: lead.company_name,
                    company_website: lead.website,
                    linkedin_url: lead.linkedin_url,
                    x_url: lead.x_url,
                    location: lead.location,
                    industry: lead.industry,
                    company_size: lead.company_size,
                    notes: lead.notes,
                  }}
                />
              </div>
              {lead.notes ? (
                <>
                  <Divider className="my-4" />
                  <p className="eyebrow mb-1.5">notes</p>
                  <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{lead.notes}</div>
                </>
              ) : null}
            </Card>
          ) : null}
        </div>

        {/* ------------------------------------------------------------ right rail */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="where they came from" hint="every source that has brought this person in" />
            <ul className="mt-3 space-y-2">
              {attributions.length === 0 ? (
                <li className="text-[12px] text-muted">no source recorded.</li>
              ) : (
                attributions.map((a) => (
                  <li key={`${a.source_name}-${a.campaign_name}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-ink">{a.source_name ?? "unattributed"}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {a.campaign_name ? `via ${a.campaign_name} · ` : ""}
                        first seen {formatDate(a.first_seen_at)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {a.occurrences > 1 ? <Badge size="xs">{a.occurrences}×</Badge> : null}
                      {a.source_kind ? (
                        <Badge tone={SOURCE_KIND_META[a.source_kind as keyof typeof SOURCE_KIND_META]?.tone ?? "slate"} size="xs">
                          {SOURCE_KIND_META[a.source_kind as keyof typeof SOURCE_KIND_META]?.label ?? a.source_kind}
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader title="owner" hint="who is looking after this" />
            <div className="mt-3">
              <OwnerPicker leadId={lead.id} current={lead.owner_id} owners={owners} />
            </div>
          </Card>

          {links.length ? (
            <Card>
              <CardHeader title="linked records" hint="same company or otherwise connected" />
              <ul className="mt-3 space-y-1">
                {links.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.related_lead_id}`} className="flex items-center gap-2 rounded-[7px] px-1.5 py-1 hover:bg-surface-2">
                      <Avatar name={l.related_name} size={22} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{l.related_name}</span>
                      <span className="shrink-0 text-[11px] text-faint">{l.kind}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {Array.isArray(merges) && merges.length ? (
            <Card>
              <CardHeader title="merged records" hint="the history of this lead includes these" />
              <ul className="mt-3 space-y-2">
                {(merges as Array<{ id: string; merged_name: string | null; reason: string | null; created_at: string; actor_name: string | null }>).map((m) => (
                  <li key={m.id} className="flex items-start gap-2">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-violet" />
                    <span className="min-w-0">
                      <span className="block text-[12px] text-ink">
                        folded in {m.merged_name ?? "another record"}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {m.reason} · {humanize(m.created_at)}
                        {m.actor_name ? ` · by ${m.actor_name}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="at a glance" />
            <div className="mt-2 divide-y divide-line">
              <KeyValue label="first seen">{formatDate(lead.created_at)}</KeyValue>
              <KeyValue label="last activity">{humanize(lead.last_activity_at ?? lead.created_at)}</KeyValue>
              <KeyValue label="next follow-up">
                {lead.next_follow_up_at ? (
                  <span className={lead.next_follow_up_at < now ? "text-rose" : ""}>{humanize(lead.next_follow_up_at)}</span>
                ) : (
                  "nothing queued"
                )}
              </KeyValue>
              <KeyValue label="source">{lead.source_name ?? "unattributed"}</KeyValue>
              <KeyValue label="industry">{lead.industry ?? "—"}</KeyValue>
              <KeyValue label="company size">{lead.company_size ?? "—"}</KeyValue>
              <KeyValue label="linkedin">
                {lead.linkedin_url ? (
                  <a href={lead.linkedin_url} target="_blank" rel="noreferrer noopener" className="link">
                    open
                  </a>
                ) : (
                  "—"
                )}
              </KeyValue>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function LeadStateControl({
  axis,
  label,
  hint,
  current,
  options,
  pinned,
  leadId,
}: {
  axis: "pipeline" | "outreach" | "nurture";
  label: string;
  hint: string;
  current: string;
  options: Array<{ value: string; label: string; tone: string }>;
  pinned: boolean;
  leadId: string;
}) {
  const meta = options.find((o) => o.value === current);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {pinned ? (
          <span className="text-[10.5px] text-faint" title="a person set this by hand, so automation is leaving it alone">
            set by hand
          </span>
        ) : (
          <span className="text-[10.5px] text-faint" title="this updates itself from what happens on the record">
            updates itself
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Badge tone={(meta?.tone ?? "slate") as never} size="sm" dot>
          {meta?.label ?? current}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>
      <LeadStateControls leadId={leadId} axis={axis} options={options} current={current} />
    </div>
  );
}

function MessageRow({ message: m }: { message: Message }) {
  const outbound = m.direction === "outbound";
  const channel = CHANNEL_META[m.channel];
  const delivery = DELIVERY_META[m.delivery_state];
  const now = nowIso();
  const late = m.next_follow_up_at ? m.next_follow_up_at < now : false;

  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
          outbound ? "bg-surface-3 text-muted" : "bg-green-soft text-green"
        }`}
        title={outbound ? "we sent this" : "they replied"}
      >
        <Icon name={outbound ? "arrow" : "chevron"} className={`size-3.5 ${outbound ? "rotate-180" : "rotate-180"}`} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={channel.tone} size="xs">
            {channel.label}
          </Badge>
          <span className={`text-[12px] ${outbound ? "text-ink-2" : "font-medium text-green"}`}>
            {outbound ? "sent" : "replied"}
          </span>
          <span className="text-[11px] text-faint">{m.sent_at ? humanize(m.sent_at) : ""}</span>
          <span className="text-[11px] text-faint">· {formatDateTime(m.sent_at)}</span>
        </div>

        {m.subject ? <p className="mt-1 truncate text-[12.5px] text-ink">{m.subject}</p> : null}
        {m.content ? (
          <p className={`mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed ${outbound ? "text-muted" : "text-ink-2"}`}>
            {m.content}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge tone={delivery.tone} size="xs">
            {delivery.label}
          </Badge>
          {m.opened_at ? <span className="text-[10.5px] text-faint">opened {humanize(m.opened_at)}</span> : null}
          {m.replied_at && m.direction === "outbound" ? (
            <span className="text-[10.5px] text-faint">answered {humanize(m.replied_at)}</span>
          ) : null}
          {m.duration_seconds ? <span className="text-[10.5px] text-faint">{Math.round(m.duration_seconds / 60)} min</span> : null}
          {m.next_follow_up_at ? (
            <span className={`text-[10.5px] ${late ? "text-rose" : "text-faint"}`}>
              follow-up {humanize(m.next_follow_up_at)}
            </span>
          ) : null}
          {m.failure_reason ? <span className="text-[10.5px] text-rose">{m.failure_reason}</span> : null}
        </div>
      </div>
    </li>
  );
}

function OwnerPicker({ leadId, current, owners }: { leadId: string; current: string | null; owners: Array<{ id: string; name: string }> }) {
  return (
    <form
      className="flex items-center gap-2"
      action={async (formData: FormData) => {
        "use server";
        const { assignLeadAction } = await import("@/app/actions");
        await assignLeadAction(leadId, (formData.get("owner_id") as string) || null);
      }}
    >
      <select name="owner_id" defaultValue={current ?? ""} className="field">
        <option value="">nobody yet</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button className="shrink-0 rounded-[7px] border border-line-strong px-2 py-1.5 text-[12px] text-ink-2 hover:bg-surface-2">set</button>
    </form>
  );
}