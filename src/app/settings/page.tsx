import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId, listMembers, getWorkspaceRow } from "@/lib/workspace";
import { formatDateTime, humanize, isPast } from "@/lib/db/time";
import { JOB_STATUS_META, SOURCE_KIND_META } from "@/lib/domain";
import { jobSummary, listJobs } from "@/lib/jobs/queue";
import { ownerPerformance } from "@/lib/queries/analytics";
import { listSources } from "@/lib/queries/sources";
import { credentialStatuses } from "@/lib/prospecting";
import { getSyncStatus } from "@/lib/gmail";
import type { AutomationRule, CustomField, Job } from "@/lib/types";
import { Avatar, Badge, Card, CardHeader, EmptyState, Icon, KeyValue } from "@/components/ui";
import { BarRow } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import {
  AddCustomFieldForm,
  AddMemberForm,
  AddRuleForm,
  DeleteRuleButton,
  DupeDecision,
  RetryJobButton,
  RuleToggle,
  RunQueueButton,
  SourceRowControls,
  WorkspaceForm,
} from "@/components/settings-forms";

export const dynamic = "force-dynamic";

const TABS = ["workspace", "team", "integrations", "gmail", "rules", "duplicates", "jobs"] as const;
type Tab = (typeof TABS)[number];

interface DupePair {
  candidate_id: string;
  confidence: number;
  match_kinds: string;
  reason: string | null;
  created_at: string;
  a: { id: string; full_name: string; email: string | null; job_title: string | null; company: string | null; stage: string };
  b: { id: string; full_name: string; email: string | null; job_title: string | null; company: string | null; stage: string };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const tab = (TABS.includes(params.tab as Tab) ? params.tab : "workspace") as Tab;

  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const workspace = getWorkspaceRow(database);

  const pendingDupes = (
    database
      .prepare(
        `SELECT d.id AS candidate_id, d.confidence, d.match_kinds, d.reason, d.created_at,
                a.id AS a_id, a.full_name AS a_name, a.email AS a_email, a.job_title AS a_title,
                a.pipeline_stage AS a_stage, ca.name AS a_company,
                b.id AS b_id, b.full_name AS b_name, b.email AS b_email, b.job_title AS b_title,
                b.pipeline_stage AS b_stage, cb.name AS b_company
             FROM dupe_candidates d
             JOIN leads a ON a.id = d.lead_id
             JOIN leads b ON b.id = d.candidate_lead_id
             LEFT JOIN companies ca ON ca.id = a.company_id
             LEFT JOIN companies cb ON cb.id = b.company_id
             WHERE d.workspace_id = ? AND d.status = 'pending'
             ORDER BY d.confidence DESC LIMIT 50`,
      )
      .all(workspaceId) as Array<Record<string, string | number | null>>
  ).map((row) => ({
    candidate_id: row.candidate_id as string,
    confidence: Number(row.confidence ?? 0),
    match_kinds: row.match_kinds ?? "[]",
    reason: row.reason,
    created_at: row.created_at as string,
    a: {
      id: row.a_id as string,
      full_name: row.a_name as string,
      email: row.a_email,
      job_title: row.a_title,
      company: row.a_company,
      stage: row.a_stage as string,
    },
    b: {
      id: row.b_id as string,
      full_name: row.b_name as string,
      email: row.b_email,
      job_title: row.b_title,
      company: row.b_company,
      stage: row.b_stage as string,
    },
  })) as DupePair[];

  const recentMerges = database
    .prepare(
      `SELECT m.id, m.primary_lead_id, m.merged_lead_id, m.created_at, m.reason,
              p.full_name AS primary_name, s.full_name AS merged_name, mem.name AS by_name
         FROM lead_merges m
         LEFT JOIN leads p ON p.id = m.primary_lead_id
         LEFT JOIN leads s ON s.id = m.merged_lead_id
         LEFT JOIN members mem ON mem.id = m.merged_by
         WHERE m.workspace_id = ? ORDER BY m.created_at DESC LIMIT 12`,
    )
    .all(workspaceId) as Array<{
    id: string;
    primary_lead_id: string;
    merged_lead_id: string;
    created_at: string;
    reason: string | null;
    primary_name: string | null;
    merged_name: string | null;
    by_name: string | null;
  }>;

  return (
    <div>
      <PageHeader
        title="settings"
        hint="how this workspace works, who is in it, and what the server is doing behind the scenes."
        tabs={
          <nav className="flex flex-wrap items-center gap-1 border-b border-line">
            {TABS.map((item) => {
              const on = item === tab;
              return (
                <Link
                  key={item}
                  href={item === "workspace" ? "/settings" : `/settings?tab=${item}`}
                  className={`-mb-px border-b-2 px-2.5 pb-2 pt-1.5 text-[12.5px] transition-colors ${
                    on ? "border-accent font-medium text-accent-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {item}
                </Link>
              );
            })}
          </nav>
        }
      />

      {tab === "workspace" && workspace ? <WorkspaceTab workspace={workspace} /> : null}
      {tab === "team" ? <TeamTab workspaceId={workspaceId} /> : null}
      {tab === "integrations" ? <IntegrationsTab workspaceId={workspaceId} /> : null}
      {tab === "gmail" ? <GmailTab workspaceId={workspaceId} /> : null}
      {tab === "rules" ? <RulesTab workspaceId={workspaceId} /> : null}
      {tab === "duplicates" ? (
        <DuplicatesTab pending={pendingDupes} merges={recentMerges} workspaceId={workspaceId} />
      ) : null}
      {tab === "jobs" ? <JobsTab workspaceId={workspaceId} /> : null}
    </div>
  );
}
// ---------------------------------------------------------------- workspace

function WorkspaceTab({ workspace }: { workspace: NonNullable<ReturnType<typeof getWorkspaceRow>> }) {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(workspace.settings_json || "{}") as Record<string, unknown>;
  } catch {
    settings = {};
  }

  const lastDigest = settings.last_digest as { date?: string; headline?: string } | undefined;

  return (
    <div>
      <PageHeader
        title="workspace"
        hint="the basics. nothing here is clever, it just has to be right."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="your workspace" hint="the basics. nothing here is clever, it just has to be right." />
            <div className="mt-4">
              <WorkspaceForm
                workspace={{
                  name: (settings.workspace_name as string) ?? workspace.name,
                  slug: (settings.slug as string) ?? workspace.slug,
                  timezone: (settings.timezone as string) ?? workspace.timezone,
                  week_starts_on: Number(settings.week_starts_on ?? workspace.week_starts_on),
                  settings,
                }}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="custom fields" hint="anything extra you want to remember about a lead or a company." />
            <div className="mt-4 space-y-3">
              <AddCustomFieldForm />
              <CustomFieldList workspaceId={workspace.id} />
            </div>
          </Card>

          {lastDigest?.headline ? (
            <Card>
              <CardHeader title="your last daily summary" hint={lastDigest.date ?? undefined} />
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{lastDigest.headline}</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="how a lead is tracked" hint="three separate questions, three separate answers." />
            <div className="mt-3 space-y-3.5">
              <Explainer
                title="where are they in the deal"
                body="this is the pipeline stage. new, qualified, meeting booked, converted and so on. it only changes when something real happens in the sale."
                tone="slate"
              />
              <Explainer
                title="have we spoken to them"
                body="this is the outreach state. it follows the messages we send and the ones we get back. it says nothing about whether we are close to winning."
                tone="blue"
              />
              <Explainer
                title="are we slowly keeping in touch"
                body="this is the nurture state. someone can sit in a sequence for six weeks without a single real conversation."
                tone="violet"
              />
              <div className="rounded-[9px] border border-line bg-surface-2/60 p-3">
                <p className="text-[12.5px] font-medium text-ink">one thing worth being clear about</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  sending a message is never counted as a reply. only something the person sends back moves them to replied. otherwise
                  every lead would look like a conversation.
                </p>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              you can set any of the three by hand on a lead. once you do, the automation leaves it alone until you release it.
            </p>
          </Card>

          <Card>
            <CardHeader title="this workspace" />
            <div className="mt-2">
              <KeyValue label="name">{workspace.name}</KeyValue>
              <KeyValue label="short name">{workspace.slug}</KeyValue>
              <KeyValue label="timezone">{workspace.timezone}</KeyValue>
              <KeyValue label="week starts">{workspace.week_starts_on === 1 ? "monday" : workspace.week_starts_on === 0 ? "sunday" : "saturday"}</KeyValue>
              <KeyValue label="set up">{formatDateTime(workspace.created_at)}</KeyValue>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Explainer({ title, body, tone }: { title: string; body: string; tone: "slate" | "blue" | "violet" }) {
  const dot: Record<string, string> = { slate: "bg-slate", blue: "bg-blue", violet: "bg-violet" };
  return (
    <div className="flex gap-2.5">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot[tone]}`} />
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

function CustomFieldList({ workspaceId }: { workspaceId: string }) {
  const database = db();
  const fields = database
    .prepare(`SELECT * FROM custom_fields WHERE workspace_id = ? ORDER BY entity, sort_order, label`)
    .all(workspaceId) as CustomField[];

  if (!fields.length) {
    return <p className="text-[12.5px] text-muted">no extra fields yet. the standard ones cover most things.</p>;
  }

  return (
    <ul className="divide-y divide-line rounded-[9px] border border-line">
      {fields.map((field) => (
        <li key={field.id} className="flex items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink">{field.label}</span>
            <span className="block truncate text-[11px] text-muted">
              {field.entity} · {field.field_type.replace("_", " ")}
              {field.options_json && field.options_json !== "[]" ? ` · ${countOptions(field.options_json)} choices` : ""}
            </span>
          </span>
          <Badge tone="slate" size="xs">
            {field.is_required ? "needed" : "optional"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function countOptions(raw: string): number {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- team

function TeamTab({ workspaceId }: { workspaceId: string }) {
  const database = db();
  const members = listMembers(database);
  const stats = ownerPerformance(workspaceId, database);
  const byId = new Map(stats.map((s) => [s.id, s]));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">your team</h2>
              <p className="mt-0.5 text-[12px] text-muted">{members.length} {members.length === 1 ? "person" : "people"} · live numbers, counted as things happen</p>
            </div>
            <AddMemberForm />
          </div>

          <ul className="divide-y divide-line">
            {members.map((member) => {
              const stat = byId.get(member.id);
              return (
                <li key={member.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar name={member.name} hue={member.avatar_hue} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium text-ink">{member.name}</span>
                        <Badge tone={member.role === "owner" ? "violet" : member.role === "admin" ? "blue" : "slate"} size="xs">
                          {member.role}
                        </Badge>
                        {member.is_active ? null : (
                          <Badge tone="stone" size="xs">
                            paused
                          </Badge>
                        )}
                      </div>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                        {member.email}
                        {member.title ? ` · ${member.title}` : ""}
                      </span>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                      <Stat label="leads" value={stat?.total ?? 0} />
                      <Stat label="replies" value={stat?.replied ?? 0} tone="green" />
                      <Stat label="won" value={stat?.converted ?? 0} tone="amber" />
                      <Stat label="open tasks" value={stat?.openTasks ?? 0} />
                      <Stat label="late" value={stat?.overdueTasks ?? 0} tone={(stat?.overdueTasks ?? 0) > 0 ? "rose" : undefined} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="who converts" hint="won deals per person" />
          <div className="mt-4 space-y-2.5">
            {stats.filter((s) => s.total > 0).length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-muted">no leads assigned to anyone yet.</p>
            ) : (
              stats
                .filter((s) => s.total > 0)
                .slice(0, 8)
                .map((s) => (
                  <BarRow
                    key={s.id}
                    label={s.name}
                    value={s.converted}
                    max={Math.max(...stats.map((x) => x.converted), 1)}
                    tone="var(--amber)"
                    right={
                      <>
                        <span className="num text-ink">{s.converted}</span>
                        <span className="ml-1.5 text-faint">of {s.total}</span>
                      </>
                    }
                    href={`/tasks?bucket=today&owner=${s.id}`}
                  />
                ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="who is behind" hint="things waiting past their time" />
          <div className="mt-3 space-y-1">
            {stats.filter((s) => s.overdueTasks > 0).length === 0 ? (
              <p className="py-3 text-center text-[12.5px] text-muted">nobody is behind. good.</p>
            ) : (
              stats
                .filter((s) => s.overdueTasks > 0)
                .map((s) => (
                  <Link
                    key={s.id}
                    href={`/tasks?bucket=overdue&owner=${s.id}`}
                    className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <Avatar name={s.name} hue={s.avatar_hue} size={24} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{s.name}</span>
                    <Badge tone="rose" size="xs">
                      {s.overdueTasks} late
                    </Badge>
                  </Link>
                ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "rose" }) {
  const color = tone === "green" ? "text-green" : tone === "amber" ? "text-amber" : tone === "rose" ? "text-rose" : "text-ink";
  return (
    <span className="text-center">
      <span className={`block text-[15px] font-semibold leading-none num ${color}`}>{value}</span>
      <span className="mt-1 block text-[10.5px] text-faint">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------- integrations

function IntegrationsTab({ workspaceId }: { workspaceId: string }) {
  const database = db();
  const sources = listSources(workspaceId, database);
  const providerStatuses = credentialStatuses(workspaceId);

  const statusTone: Record<string, "green" | "amber" | "rose" | "slate"> = {
    connected: "green",
    needs_attention: "amber",
    disconnected: "rose",
    paused: "slate",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">prospect data providers</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                what lead generation searches for real people. a key is needed before it can search — nothing is invented
                without one.
              </p>
            </div>
            <Link
              href="/generate"
              className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5 5.5 8 8 5.5" /><path d="M4 12.5 5.5 14 8 11.5" /><path d="M4 18.5 5.5 20 8 17.5" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>
              add provider
            </Link>
          </div>

          <ul className="divide-y divide-line">
            {providerStatuses.map((status) => (
              <li key={status.provider} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{status.label}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {status.configured
                      ? `key ${status.hint ?? "saved"}${status.source === "environment" ? " · set in the environment" : " · stored encrypted"}`
                      : "not connected"}
                    {status.plan ? ` · ${status.plan} plan` : ""}
                    {status.lastError ? ` · ${status.lastError}` : ""}
                  </span>
                </span>
                <Badge tone={status.configured ? "green" : "slate"} size="xs" dot>
                  {status.configured ? "connected" : "not connected"}
                </Badge>
                <Link href="/generate" className="shrink-0 text-[12px] text-accent-ink hover:underline">
                  {status.configured ? "open lead generation" : "add a key"}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card padded={false} className="mt-4">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">connected sources</h2>
              <p className="mt-0.5 text-[12px] text-muted">everything your leads arrive through</p>
            </div>
            <Link
              href="/sources"
              className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5 5.5 8 8 5.5" /><path d="M4 12.5 5.5 14 8 11.5" /><path d="M4 18.5 5.5 20 8 17.5" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>
              connect one
            </Link>
          </div>

          {sources.length === 0 ? (
            <EmptyState
              title="nothing is connected yet"
              hint="connect a platform, upload a list, or add a form to your site and new people will start showing up on their own."
              icon={<svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="17" r="2.4" /><circle cx="12" cy="6" r="2.4" /><circle cx="18" cy="14" r="2.4" /><path d="m7.6 15.2 2.8-7M13.8 7.8l2.6 4.5M8.3 16.4l7.4-1.7" /></svg>}
              action={
                <Link href="/sources" className="text-[12.5px] text-accent-ink hover:underline">
                  go to sources →
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {sources.map((source) => (
                <li key={source.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium text-ink">{source.name}</span>
                        <Badge tone={SOURCE_KIND_META[source.kind].tone} size="xs">
                          {SOURCE_KIND_META[source.kind].label}
                        </Badge>
                        <Badge tone={statusTone[source.status] ?? "slate"} size="xs" dot>
                          {source.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-muted">
                        {source.kind === "integration" || source.kind === "import"
                          ? "brings in new people and keeps their details fresh"
                          : source.kind === "form"
                          ? "captures people who fill in a form"
                          : "tags where these leads came from"}
                        {" · "}
                        {source.last_sync_at ? `last checked ${humanize(source.last_sync_at)}` : "never checked yet"}
                        {source.notes ? ` · ${source.notes}` : ""}
                      </p>
                    </div>

                    <span className="num shrink-0 text-[11.5px] text-muted">
                      {source.lead_count} leads · {source.converted_count} won
                    </span>

                    <SourceRowControls sourceId={source.id} status={source.status} cadence={source.sync_cadence_hours} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="how syncing works" />
          <div className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
            <p>every source has its own pace. hourly is plenty for most teams, weekly is fine for a slow list.</p>
            <p>checks happen on the server, so they keep going when you close your laptop.</p>
            <p>if something breaks, the source turns amber and the reason shows up on the sources page.</p>
          </div>
          <Link href="/sources" className="mt-3 block text-center text-[12px] text-accent-ink hover:underline">
            manage imports and forms →
          </Link>
        </Card>

        <Card>
          <CardHeader title="sync cadence" hint="how many are checking in right now" />
          <div className="mt-4 space-y-2.5">
            {sources.length === 0 ? (
              <p className="py-3 text-center text-[12.5px] text-muted">nothing connected yet.</p>
            ) : (
              cadenceRows(sources).map((row) => (
                <BarRow
                  key={row.hours}
                  label={cadenceLabel(row.hours)}
                  value={row.count}
                  max={Math.max(...cadenceRows(sources).map((r) => r.count), 1)}
                  tone="var(--blue)"
                  right={<span className="num text-ink">{row.count}</span>}
                />
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function cadenceRows(sources: Array<{ sync_cadence_hours: number }>): Array<{ hours: number; count: number }> {
  const map = new Map<number, number>();
  for (const s of sources) map.set(s.sync_cadence_hours, (map.get(s.sync_cadence_hours) ?? 0) + 1);
  return [...map.entries()]
    .map(([hours, count]) => ({ hours, count }))
    .sort((a, b) => a.hours - b.hours);
}

function cadenceLabel(hours: number): string {
  if (hours <= 1) return "every hour";
  if (hours === 6) return "every 6 hours";
  if (hours === 12) return "twice a day";
  if (hours === 24) return "every day";
  if (hours === 72) return "every 3 days";
  return "once a week";
}

// ---------------------------------------------------------------- gmail

function GmailTab({ workspaceId }: { workspaceId: string }) {
  const syncStatus = getSyncStatus(workspaceId);
  const accounts = syncStatus.filter((s) => s.status === "connected");

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card padded={false}>
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">gmail integration</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              sync sent and received emails, match them to leads, and send emails from leadflow.
            </p>
          </div>
          {accounts.length === 0 ? (
            <div className="px-4 py-6">
              <p className="text-center text-[12.5px] text-muted">no gmail accounts connected yet.</p>
              <div className="mt-3 text-center">
                <a href="/settings?tab=integrations" className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2">
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>
                  connect gmail
                </a>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <svg className="size-5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>
                      <span className="block truncate text-[13px] text-ink">{account.email}</span>
                      {account.is_default && <Badge tone="blue" size="xs">default</Badge>}
                    </div>
                    <span className="text-[11.5px] text-muted">
                      last sync {account.last_sync_at ? " " + account.last_sync_at : "never"} · {account.status}
                      {account.last_error ? " · error: " + account.last_error : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="blue" size="xs" dot>{account.status}</Badge>
                    <Link href="/gmail" className="text-[12px] text-accent-ink hover:underline">open inbox</Link>
                    <a href="/gmail/drafts" className="text-[12px] text-accent-ink hover:underline">drafts</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="mt-4">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">sync activity</h2>
            <p className="mt-0.5 text-[12px] text-muted">recent sync runs and their results</p>
          </div>
          <ul className="divide-y divide-line">
            <li className="px-4 py-3 text-center text-[12.5px] text-muted">sync history will appear here after first sync</li>
          </ul>
        </Card>

        <Card className="mt-4">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">drafts</h2>
              <p className="mt-0.5 text-[12px] text-muted">emails waiting for approval or already sent</p>
            </div>
            <a href="/gmail/drafts" className="text-[12px] text-accent-ink hover:underline">manage drafts →</a>
          </div>
          <div className="px-4 pb-3">
            <p className="text-center py-6 text-[12.5px] text-muted">drafts appear here after you compose them</p>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">how it works</h2>
            <p className="mt-0.5 text-[12px] text-muted">a quick guide to the gmail integration</p>
          </div>
          <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg><span><span className="text-ink-2">connect once.</span> oauth with google. your password never leaves google.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg><span><span className="text-ink-2">sync is automatic.</span> the server pulls new emails every 15 minutes. you can also press sync now.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg><span><span className="text-ink-2">matching is automatic.</span> emails are matched to leads by email address and thread. you review probable matches.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg><span><span className="text-ink-2">you approve before sending.</span> drafts wait for your approval. nothing sends without you.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg><span><span className="text-ink-2">replies update states automatically.</span> when someone replies, their lead moves to <span className="font-medium">replied</span> and follow-ups clear.</span></li>
          </ul>
        </Card>

        <Card>
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">troubleshooting</h2>
            <p className="mt-0.5 text-[12px] text-muted">common issues and how to fix them</p>
          </div>
          <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19H3Z" /><path d="M12 10v4" /><path d="M12 16h.01" /></svg><span><span className="text-ink-2">"oauth consent screen not configured"</span> — go to google cloud console → apis & services → oauth consent screen and publish the app.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19H3Z" /><path d="M12 10v4" /><path d="M12 16h.01" /></svg><span><span className="text-ink-2">"invalid_grant" or "token expired"</span> — the refresh token expired. disconnect and reconnect the account.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19H3Z" /><path d="M12 10v4" /><path d="M12 16h.01" /></svg><span><span className="text-ink-2">"emails not syncing"</span> — check the sync status above. press sync now. check google cloud quotas.</span></li>
            <li className="flex gap-2.5"><svg className="mt-0.5 size-3.5 shrink-0 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19H3Z" /><path d="M12 10v4" /><path d="M12 16h.01" /></svg><span><span className="text-ink-2">"emails not matching to leads"</span> — leads are matched by email address. make sure the lead has the same email in leadflow.</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rules

const TRIGGER_LABEL: Record<string, string> = {
  lead_created: "when a lead arrives",
  reply_received: "when someone replies",
  no_reply: "when nobody replies",
  stage_changed: "when the stage changes",
  meeting_booked: "when a meeting is booked",
  task_overdue: "when a task runs late",
  nurture_step_sent: "after a nurture step",
  import_completed: "after an import",
};

function RulesTab({ workspaceId }: { workspaceId: string }) {
  const database = db();
  const rules = database
    .prepare(`SELECT * FROM automation_rules WHERE workspace_id = ? ORDER BY is_enabled DESC, name`)
    .all(workspaceId) as AutomationRule[];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">automation rules</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                when something happens, do this without being asked. they run on the server, so nothing waits on a browser.
              </p>
            </div>
            <AddRuleForm />
          </div>

          {rules.length === 0 ? (
            <EmptyState
              title="no rules yet"
              hint="a rule is just an if and a then. when a lead arrives, move them to to qualify and set a first follow-up."
              icon={<svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19H3Z" /><path d="M12 10v4" /><path d="M12 16h.01" /></svg>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((rule) => {
                const conditions = parseObject(rule.conditions_json);
                const actions = parseArray(rule.actions_json);
                return (
                  <li key={rule.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13px] font-medium text-ink">{rule.name}</span>
                          <Badge tone="cyan" size="xs">
                            {TRIGGER_LABEL[rule.trigger_type] ?? rule.trigger_type.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        {rule.description ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{rule.description}</p> : null}

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {conditions.length ? (
                            conditions.map((c, i) => (
                              <Badge key={`c${i}`} tone="slate" size="xs">
                                if {c}
                              </Badge>
                            ))
                          ) : (
                            <Badge tone="slate" size="xs">
                              any lead
                            </Badge>
                          )}
                          {actions.map((a, i) => (
                            <Badge key={`a${i}`} tone="blue" size="xs">
                              then {a}
                            </Badge>
                          ))}
                        </div>

                        <p className="mt-2 text-[11px] text-faint">
                          has run {rule.run_count} {rule.run_count === 1 ? "time" : "times"}
                          {rule.last_run_at ? ` · last ${humanize(rule.last_run_at)}` : " · never run yet"}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <RuleToggle ruleId={rule.id} enabled={rule.is_enabled === 1} />
                        <DeleteRuleButton ruleId={rule.id} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="what a rule looks like" />
          <div className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
            <p>when a lead arrives</p>
            <p className="pl-3 text-faint">if they have a company email</p>
            <p>then set the stage to to qualify</p>
            <p>then give them a call tomorrow at 9am</p>
            <p className="pt-1">
              that is the whole idea. anything more complicated belongs in a sequence.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="what is switched on" />
          <div className="mt-3 space-y-2">
            {rules.filter((r) => r.is_enabled === 1).length === 0 ? (
              <p className="text-[12.5px] text-muted">nothing is running right now.</p>
            ) : (
              rules
                .filter((r) => r.is_enabled === 1)
                .map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] text-ink">{r.name}</span>
                    <Badge tone="green" size="xs">
                      on
                    </Badge>
                  </div>
                ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function parseObject(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return [];
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) =>
      typeof value === "object" ? `${key}` : `${key} is ${String(value)}`,
    );
  } catch {
    return [];
  }
}

function parseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item.replaceAll("_", " ") : item && typeof item === "object" && "type" in item ? String((item as { type: unknown }).type).replaceAll("_", " ") : "do something"))
      .slice(0, 4);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- duplicates

function DuplicatesTab({
  pending,
  merges,
  workspaceId,
}: {
  pending: DupePair[];
  merges: Array<{
    id: string;
    primary_lead_id: string;
    merged_lead_id: string;
    created_at: string;
    reason: string | null;
    primary_name: string | null;
    merged_name: string | null;
    by_name: string | null;
  }>;
  workspaceId: string;
}) {
  const database = db();
  const resolved = (
    database
      .prepare(`SELECT status, COUNT(*) AS n FROM dupe_candidates WHERE workspace_id = ? GROUP BY status`)
      .all(workspaceId) as Array<{ status: string; n: number }>
  ).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: row.n }), {});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">worth a second look</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                pairs we are not confident enough to join on our own
              </p>
            </div>
            <Badge tone={pending.length ? "amber" : "green"} size="sm">
              {pending.length} waiting
            </Badge>
          </div>

          {pending.length === 0 ? (
            <EmptyState
              title="nothing to look at"
              hint="we merge the obvious ones by themselves — an exact email match is one person, not two. anything we are unsure about waits here for you."
              icon={<svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((pair) => {
                const kinds = parseArray(pair.match_kinds);
                const shared = sharedFields(pair);
                return (
                  <li key={pair.candidate_id} className="px-4 py-3.5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">
                        {Math.round(pair.confidence * 100)}% sure
                      </span>
                      {pair.reason ? <span className="text-[12px] text-muted">{pair.reason}</span> : null}
                      <span className="ml-auto text-[11px] text-faint">found {humanize(pair.created_at)}</span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <LeadCard lead={pair.a} />
                      <LeadCard lead={pair.b} />
                    </div>

                    {kinds.length || shared.length ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {kinds.map((k, i) => (
                          <Badge key={`k${i}`} tone="cyan" size="xs">
                            matched on {k}
                          </Badge>
                        ))}
                        {shared.map((field) => (
                          <Badge key={field} tone="slate" size="xs">
                            same {field}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <DupeDecision candidateId={pair.candidate_id} action="merge" label="merge them" variant="primary" />
                      <DupeDecision candidateId={pair.candidate_id} action="link" label="they are different people" />
                      <DupeDecision candidateId={pair.candidate_id} action="dismiss" label="ignore" variant="ghost" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="what gets decided for you" />
          <div className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
            <p>an identical email address. two rows with the same address are the same person, so they merge straight away.</p>
            <p>everything else waits for you. being wrong here is expensive — you lose a real conversation.</p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
            <Count label="merged" value={resolved.merged ?? 0} />
            <Count label="linked" value={resolved.linked ?? 0} />
            <Count label="ignored" value={resolved.dismissed ?? 0} />
          </div>
        </Card>

        <Card>
          <CardHeader title="recently merged" hint="what the server joined on its own, and what you joined" />
          <div className="mt-3 space-y-1">
            {merges.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-muted">nothing has been merged yet.</p>
            ) : (
              merges.map((merge) => (
                <div key={merge.id} className="rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/leads/${merge.primary_lead_id}`} className="min-w-0 truncate text-[12.5px] text-ink hover:underline">
                      {merge.primary_name ?? "a lead"}
                    </Link>
                    <span className="shrink-0 text-[10.5px] text-faint">{humanize(merge.created_at)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    kept this one, folded in {merge.merged_name ?? "another record"}
                    {merge.by_name ? ` · by ${merge.by_name}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function sharedFields(pair: DupePair): string[] {
  const shared: string[] = [];
  if (pair.a.email && pair.b.email && pair.a.email.toLowerCase() === pair.b.email.toLowerCase()) shared.push("email");
  if (pair.a.company && pair.b.company && pair.a.company.toLowerCase() === pair.b.company.toLowerCase()) shared.push("company");
  if (pair.a.job_title && pair.b.job_title && pair.a.job_title.toLowerCase() === pair.b.job_title.toLowerCase())
    shared.push("job title");
  return shared;
}

function LeadCard({ lead }: { lead: DupePair["a"] }) {
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="block rounded-[10px] border border-line bg-surface-2/50 p-3 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={lead.full_name} size={30} />
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium text-ink">{lead.full_name}</div>
          <div className="truncate text-[11px] text-muted">{[lead.job_title, lead.company].filter(Boolean).join(" at ") || "—"}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted">{lead.email ?? "—"}</span>
        <Badge tone="slate" size="xs">
          {lead.stage.replaceAll("_", " ")}
        </Badge>
      </div>
    </Link>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="num text-[17px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1 text-[10.5px] text-faint">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------- jobs

function JobsTab({ workspaceId }: { workspaceId: string }) {
  const database = db();
  const summary = jobSummary(workspaceId, database);
  const jobs = listJobs(workspaceId, 40, database) as Job[];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">background work</h2>
              <p className="mt-0.5 text-[12px] text-muted">the last {jobs.length} jobs the server ran</p>
            </div>
            <RunQueueButton />
          </div>

          {jobs.length === 0 ? (
            <EmptyState
              title="nothing has run yet"
              hint="the server wakes up on its own every fifteen seconds. press run the queue now if you want to see it move."
              icon={<svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 21 19H3Z" /><path d="M12 10v4" /><path d="M12 16h.01" /></svg>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {jobs.map((job) => {
                const meta = JOB_STATUS_META[job.status] ?? JOB_STATUS_META.pending;
                const due = isPast(job.run_at) && job.status === "pending" ? "due now" : humanize(job.run_at);
                return (
                  <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[12.5px] text-ink">
                          {JOB_KIND_LABEL[job.kind] ?? job.kind.replaceAll("_", " ")}
                        </span>
                        <Badge tone={meta.tone} size="xs" dot>
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        {due} · try {job.attempts} of {job.max_attempts}
                        {job.last_error ? ` · ${job.last_error}` : ""}
                      </p>
                    </div>

                    {job.status === "failed" || job.status === "cancelled" ? <RetryJobButton jobId={job.id} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="where the queue is" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <QueueCard label="waiting" value={summary.pending} tone={summary.pending ? "amber" : "green"} />
            <QueueCard label="running" value={summary.running} tone="blue" />
            <QueueCard label="done" value={summary.succeeded} tone="green" />
            <QueueCard label="failed" value={summary.failed} tone={summary.failed ? "rose" : "slate"} />
          </div>
          {summary.pending ? (
            <p className="mt-3 text-[11.5px] text-muted">
              the oldest has been waiting {summary.oldestPendingMinutes} {summary.oldestPendingMinutes === 1 ? "minute" : "minutes"}.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="nothing gets lost" />
          <div className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
            <p>reminders, nurture steps and daily summaries all run on the server. closing your browser does not stop them.</p>
            <p>if something fails it is retried a few times with a longer wait each time. nothing quietly disappears.</p>
            <p>after it runs out of tries it waits here for you, and the retry button puts it straight back in the queue.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="recent failures" hint="worth a glance if there are any" />
          <div className="mt-3 space-y-1">
            {jobs.filter((j) => j.status === "failed").length === 0 ? (
              <p className="py-3 text-center text-[12.5px] text-muted">nothing has failed. all good.</p>
            ) : (
              jobs
                .filter((j) => j.status === "failed")
                .slice(0, 5)
                .map((job) => (
                  <div key={job.id} className="rounded-[7px] bg-rose-soft/50 px-2 py-1.5">
                    <p className="truncate text-[12px] text-rose">{JOB_KIND_LABEL[job.kind] ?? job.kind}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted">{job.last_error ?? "no reason given"}</p>
                  </div>
                ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function QueueCard({ label, value, tone }: { label: string; value: number; tone: "amber" | "blue" | "green" | "rose" | "slate" }) {
  const color: Record<string, string> = {
    amber: "text-amber",
    blue: "text-blue",
    green: "text-green",
    rose: "text-rose",
    slate: "text-slate",
  };
  return (
    <div className="rounded-[10px] border border-line bg-surface-2/50 p-2.5">
      <div className="text-[11.5px] leading-tight text-muted">{label}</div>
      <div className={`num mt-1 text-[20px] font-semibold leading-none tracking-[-0.03em] ${color[tone]}`}>{value}</div>
    </div>
  );
}
