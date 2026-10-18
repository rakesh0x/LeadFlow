"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, tx } from "@/lib/db/client";
import { nowIso } from "@/lib/db/time";
import { currentMemberSync, requireWorkspaceId } from "@/lib/workspace";
import { OUTREACH_STATES, NURTURE_STATES, PIPELINE_STAGES, TASK_TYPES, PRIORITIES, CHANNELS } from "@/lib/domain";
import type { Channel, NurtureState, OutreachState, PipelineStage, Priority, TaskType } from "@/lib/domain";
import {
  addNote,
  archiveLead,
  archiveLead as doArchive,
  assignLead,
  createLead,
  linkLeadRecords,
  mergeLead,
  setNurtureState,
  setOutreachState,
  setStage,
  updateLead,
} from "@/lib/queries/leads";
import { completeTask, createTask, deleteTask, reopenTask, updateTask } from "@/lib/queries/tasks";
import {
  createCampaign,
  logInboundMessage,
  logOutboundMessage,
  setMessageFollowUp,
  updateCampaign,
  updateDelivery,
} from "@/lib/queries/outreach";
import { bookMeeting, createOpportunity, updateMeeting, updateOpportunity } from "@/lib/queries/deals";
import { completeEnrollment, createSequence, enrollLead, pauseEnrollment } from "@/lib/queries/nurture";
import { createForm, createImport, createSource, updateSource } from "@/lib/queries/sources";
import { releaseState } from "@/lib/engine/states";
import { resolveDupe, findMatches } from "@/lib/engine/dedupe";
import { enqueue, retryJob } from "@/lib/jobs/queue";
import { ensureRecurringJobs } from "@/lib/jobs/scheduler";
import { buildDigest } from "@/lib/jobs/digest";

type Result = { ok: boolean; message?: string; error?: string; id?: string; redirectTo?: string };

const str = (v: FormDataEntryValue | null): string | null => {
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

async function revalidateAll() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- leads

export async function createLeadAction(input: {
  full_name: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  company_name?: string | null;
  company_website?: string | null;
  linkedin_url?: string | null;
  x_url?: string | null;
  location?: string | null;
  industry?: string | null;
  company_size?: string | null;
  notes?: string | null;
  source_id?: string | null;
  owner_id?: string | null;
  campaign_id?: string | null;
}): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const name = input.full_name?.trim() ?? "";
  if (!name && !input.email) return { ok: false, error: "a name or an email is needed" };

  const result = createLead(workspaceId, { ...input, full_name: name }, { database, actorId: member?.id ?? null, origin: "you" });

  if (result.mergedInto) {
    revalidatePath(`/leads/${result.mergedInto}`);
    return {
      ok: true,
      id: result.mergedInto,
      message: "looks like we already had this person, so we added the new details to their record",
    };
  }

  await revalidateAll();
  return { ok: true, id: result.leadId, message: result.reviewCount ? "added — we found a possible duplicate worth a look" : "lead added" };
}

export async function updateLeadAction(leadId: string, patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  updateLead(database, workspaceId, leadId, patch as never, member?.id ?? null);
  revalidatePath(`/leads/${leadId}`);
  await revalidateAll();
  return { ok: true };
}

export async function setStageAction(leadId: string, stage: PipelineStage): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const value = oneOf(stage, PIPELINE_STAGES, "new");
  setStage(database, workspaceId, leadId, value, member?.id ?? null);
  revalidatePath(`/leads/${leadId}`);
  await revalidateAll();
  return { ok: true };
}

export async function setOutreachStateAction(leadId: string, state: OutreachState): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  setOutreachState(database, workspaceId, leadId, oneOf(state, OUTREACH_STATES, "never_contacted"), member?.id ?? null);
  revalidatePath(`/leads/${leadId}`);
  await revalidateAll();
  return { ok: true };
}

export async function setNurtureStateAction(leadId: string, state: NurtureState): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  setNurtureState(database, workspaceId, leadId, oneOf(state, NURTURE_STATES, "not_enrolled"), member?.id ?? null);
  revalidatePath(`/leads/${leadId}`);
  await revalidateAll();
  return { ok: true };
}

export async function releaseStateAction(leadId: string, axis: "pipeline" | "outreach" | "nurture"): Promise<Result> {
  const database = db();
  releaseState(database, leadId, axis);
  revalidatePath(`/leads/${leadId}`);
  await revalidateAll();
  return { ok: true, message: "automation is looking after this again" };
}

export async function addNoteAction(leadId: string, body: string): Promise<Result> {
  if (!body.trim()) return { ok: false, error: "the note is empty" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  addNote(database, workspaceId, leadId, body.trim(), currentMemberSync()?.id);
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

export async function assignLeadAction(leadId: string, ownerId: string | null): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  assignLead(database, workspaceId, leadId, ownerId || null, currentMemberSync()?.id);
  revalidatePath(`/leads/${leadId}`);
  await revalidateAll();
  return { ok: true };
}

export async function archiveLeadAction(leadId: string, archived: boolean): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  doArchive(database, workspaceId, leadId, archived, currentMemberSync()?.id);
  await revalidateAll();
  return { ok: true };
}

export async function mergeLeadAction(primaryId: string, secondaryId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const result = mergeLead(database, workspaceId, primaryId, secondaryId, member?.id);
  if (!result.ok) return { ok: false, error: result.error ?? "could not merge those two" };
  revalidatePath(`/leads/${primaryId}`);
  await revalidateAll();
  return { ok: true, message: "merged. every message, task and source moved across." };
}

export async function linkLeadAction(leadId: string, relatedId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  linkLeadRecords(database, workspaceId, leadId, relatedId, "related", currentMemberSync()?.id);
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, message: "linked" };
}

export async function resolveDupeAction(candidateId: string, decision: "merge" | "dismiss" | "link"): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const result = resolveDupe(database, workspaceId, candidateId, decision, member?.id);
  if (!result.ok) return { ok: false, error: "that match is no longer there" };
  if (result.primaryLeadId) revalidatePath(`/leads/${result.primaryLeadId}`);
  await revalidateAll();
  return { ok: true, message: decision === "merge" ? "merged" : decision === "link" ? "kept both and linked them" : "left them separate" };
}

export async function searchDuplicateMatchesAction(query: string): Promise<Result & { matches: unknown[] }> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, matches: [] };

  const email = trimmed.includes("@") ? trimmed : `${trimmed}@`;
  const rows = database
    .prepare(
      `SELECT id, full_name, email, company_id FROM leads
       WHERE workspace_id = ? AND merged_into_lead_id IS NULL
         AND (full_name LIKE ? OR email_normalized LIKE ? OR id = ?) LIMIT 25`,
    )
    .all(workspaceId, `%${trimmed.toLowerCase()}%`, `%${email.toLowerCase()}%`, trimmed) as Array<Record<string, string | null>>;

  const matches = findMatches(database, workspaceId, { email: trimmed.includes("@") ? trimmed : null, full_name: trimmed }, rows.map((r) => r.id as string));
  return { ok: true, matches };
}

// ---------------------------------------------------------------- tasks

export async function createTaskAction(input: {
  title: string;
  lead_id?: string | null;
  campaign_id?: string | null;
  description?: string | null;
  type?: TaskType;
  priority?: Priority;
  due_at?: string | null;
  owner_id?: string | null;
}): Promise<Result> {
  if (!input.title?.trim()) return { ok: false, error: "the task needs a title" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const id = createTask(
    {
      workspaceId,
      title: input.title.trim(),
      leadId: input.lead_id ?? null,
      campaignId: input.campaign_id ?? null,
      description: input.description ?? null,
      type: oneOf(input.type, TASK_TYPES, "follow_up"),
      priority: oneOf(input.priority, PRIORITIES, "medium"),
      dueAt: input.due_at ?? null,
      ownerId: input.owner_id ?? member?.id ?? null,
    },
    { actorId: member?.id, database },
  );
  revalidatePath(`/leads/${input.lead_id ?? ""}`);
  await revalidateAll();
  return { ok: true, id: id ?? undefined };
}

export async function completeTaskAction(taskId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const ok = completeTask(database, workspaceId, taskId, currentMemberSync()?.id);
  await revalidateAll();
  return { ok, message: ok ? "done" : "that task was already finished" };
}

export async function reopenTaskAction(taskId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  reopenTask(database, workspaceId, taskId, currentMemberSync()?.id);
  await revalidateAll();
  return { ok: true };
}

export async function updateTaskAction(taskId: string, patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  updateTask(database, workspaceId, taskId, patch as never, currentMemberSync()?.id);
  await revalidateAll();
  return { ok: true };
}

export async function deleteTaskAction(taskId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  deleteTask(database, workspaceId, taskId);
  await revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------- outreach

export async function sendMessageAction(input: {
  lead_id: string;
  channel?: Channel | null;
  subject?: string | null;
  content?: string | null;
  campaign_id?: string | null;
  follow_up_days?: number | null;
  duration_seconds?: number | null;
  /** set when someone is logging something that already happened by phone. */
  call_outcome?: string | null;
}): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  if (!input.content?.trim() && !input.subject?.trim()) return { ok: false, error: "there is nothing to send" };

  const id = logOutboundMessage(
    database,
    {
      workspaceId,
      leadId: input.lead_id,
      channel: oneOf(input.channel, CHANNELS, "email"),
      subject: input.subject ?? null,
      content: input.content ?? null,
      campaign_id: input.campaign_id ?? null,
      owner_id: member?.id ?? null,
      followUpAfterDays: input.follow_up_days ?? null,
      durationSeconds: input.duration_seconds ?? null,
      deliveryState: input.channel === "phone" ? (input.call_outcome === "missed" ? "missed" : "connected") : "sent",
    },
    member?.id,
  );

  revalidatePath(`/leads/${input.lead_id}`);
  await revalidateAll();
  return { ok: true, id, message: "logged" };
}

export async function recordReplyAction(input: {
  lead_id: string;
  channel?: Channel | null;
  content: string;
  subject?: string | null;
  in_reply_to?: string | null;
}): Promise<Result> {
  if (!input.content.trim()) return { ok: false, error: "the reply is empty" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const id = logInboundMessage(
    database,
    {
      workspaceId,
      leadId: input.lead_id,
      channel: oneOf(input.channel, CHANNELS, "email"),
      subject: input.subject ?? null,
      content: input.content.trim(),
      inReplyToMessageId: input.in_reply_to ?? null,
    },
    member?.id,
  );
  revalidatePath(`/leads/${input.lead_id}`);
  await revalidateAll();
  return { ok: true, id };
}

export async function updateDeliveryAction(messageId: string, state: string, reason?: string | null): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  updateDelivery(database, messageId, state as never, { failure_reason: reason ?? null }, currentMemberSync()?.id);
  await revalidateAll();
  return { ok: true };
}

export async function setFollowUpAction(messageId: string, followUpAt: string | null, createTaskToo: boolean): Promise<Result> {
  const database = db();
  setMessageFollowUp(database, messageId, followUpAt ?? null, {
    createTask: createTaskToo,
    actorId: currentMemberSync()?.id ?? null,
    ownerId: currentMemberSync()?.id ?? null,
  });
  await revalidateAll();
  return { ok: true, message: followUpAt ? "follow-up set" : "follow-up cleared" };
}

export async function createCampaignAction(input: { name: string; channel?: Channel; description?: string | null; status?: string }): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "the campaign needs a name" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const id = createCampaign(workspaceId, {
    name: input.name.trim(),
    channel: input.channel ?? "email",
    description: input.description ?? null,
    status: (input.status as never) ?? "draft",
    owner_id: member?.id ?? null,
  });
  revalidatePath("/outreach");
  return { ok: true, id };
}

export async function updateCampaignAction(campaignId: string, patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  updateCampaign(workspaceId, campaignId, patch as never);
  revalidatePath("/outreach");
  return { ok: true };
}

// ---------------------------------------------------------------- deals

export async function bookMeetingAction(input: {
  lead_id: string;
  title?: string;
  scheduled_at: string;
  duration_minutes?: number;
  location?: string | null;
  agenda?: string | null;
}): Promise<Result> {
  if (!input.scheduled_at) return { ok: false, error: "pick a time for the meeting" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const id = bookMeeting(
    database,
    {
      workspaceId,
      leadId: input.lead_id,
      title: input.title ?? "meeting",
      scheduledAt: input.scheduled_at,
      durationMinutes: input.duration_minutes ?? 30,
      location: input.location ?? null,
      agenda: input.agenda ?? null,
      ownerId: member?.id ?? null,
    },
    member?.id,
  );
  revalidatePath(`/leads/${input.lead_id}`);
  await revalidateAll();
  return { ok: true, id, message: "meeting booked" };
}

export async function updateMeetingAction(meetingId: string, patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  updateMeeting(database, workspaceId, meetingId, patch as never, currentMemberSync()?.id);
  await revalidateAll();
  return { ok: true };
}

export async function createOpportunityAction(input: { lead_id: string; name: string; amount?: number; stage?: string; expected_close_at?: string | null }): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "the opportunity needs a name" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const id = createOpportunity(
    database,
    {
      workspaceId,
      leadId: input.lead_id,
      name: input.name.trim(),
      amount: Number(input.amount ?? 0),
      stage: (input.stage as never) ?? "qualifying",
      expectedCloseAt: input.expected_close_at ?? null,
      ownerId: member?.id ?? null,
    },
    member?.id,
  );
  revalidatePath(`/leads/${input.lead_id}`);
  await revalidateAll();
  return { ok: true, id };
}

export async function updateOpportunityAction(opportunityId: string, patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const ok = updateOpportunity(database, workspaceId, opportunityId, patch as never, currentMemberSync()?.id);
  await revalidateAll();
  return { ok, message: ok && patch.stage === "won" ? "marked as won — nice one" : undefined };
}

// ---------------------------------------------------------------- nurture

export async function createSequenceAction(input: { name: string; description?: string | null; steps: Array<{ subject: string; content: string; waitDays: number; channel?: Channel | null }> }): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "the sequence needs a name" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const id = createSequence(workspaceId, {
    name: input.name.trim(),
    description: input.description ?? null,
    steps: input.steps.map((s, i) => ({ name: s.subject || `step ${i + 1}`, waitDays: s.waitDays ?? 0, channel: s.channel ?? "email", subject: s.subject ?? "", content: s.content ?? "" })),
  });
  revalidatePath("/nurture");
  return { ok: true, id };
}

export async function enrollLeadAction(leadId: string, sequenceId: string, startDelayDays = 0): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const id = enrollLead(database, workspaceId, leadId, sequenceId, { actorId: member?.id, startDelayDays });
  if (!id) return { ok: false, error: "that sequence has no steps yet" };
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/nurture");
  return { ok: true, message: "added to the sequence — the first step is queued on the server" };
}

export async function pauseEnrollmentAction(enrollmentId: string, paused: boolean): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  pauseEnrollment(database, workspaceId, enrollmentId, paused, currentMemberSync()?.id);
  revalidatePath("/nurture");
  await revalidateAll();
  return { ok: true, message: paused ? "paused" : "picking back up" };
}

export async function completeEnrollmentAction(enrollmentId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  completeEnrollment(database, workspaceId, enrollmentId, currentMemberSync()?.id);
  revalidatePath("/nurture");
  await revalidateAll();
  return { ok: true, message: "sequence finished" };
}

// ---------------------------------------------------------------- sources and imports

export async function createSourceAction(input: { name: string; kind: string; notes?: string | null }): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "the source needs a name" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const id = createSource(workspaceId, { name: input.name.trim(), kind: input.kind as never, notes: input.notes ?? null });
  revalidatePath("/sources");
  return { ok: true, id };
}

export async function updateSourceAction(sourceId: string, patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  updateSource(workspaceId, sourceId, patch as never);
  revalidatePath("/sources");
  return { ok: true };
}

export async function syncSourceAction(sourceId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  enqueue({ workspaceId, kind: "source_sync", payload: { workspaceId, sourceId }, idempotencyKey: `manual-sync:${sourceId}:${nowIso().slice(0, 16)}` }, database);
  revalidatePath("/sources");
  return { ok: true, message: "queued — it will run on the server in a moment" };
}

export async function createFormAction(input: { name: string; source_id?: string | null }): Promise<Result> {
  if (!input.name?.trim()) return { ok: false, error: "the form needs a name" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const id = createForm(workspaceId, { name: input.name.trim(), source_id: input.source_id ?? null });
  revalidatePath("/sources");
  return { ok: true, id };
}

export async function importLeadsAction(input: {
  name: string;
  source_id?: string | null;
  rows: Array<Record<string, string>>;
}): Promise<Result> {
  if (!input.rows?.length) return { ok: false, error: "there is nothing in that file" };
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const sourceId = input.source_id ?? null;

  const importId = createImport(workspaceId, { name: input.name || "import", source_id: sourceId, created_by: member?.id }, database);
  database.prepare(`UPDATE lead_imports SET status = 'processing', total_rows = ?, updated_at = ? WHERE id = ?`).run(input.rows.length, nowIso(), importId);

  let imported = 0;
  let merged = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];

  const run = database.transaction(() => {
    input.rows.forEach((row, index) => {
      const fullName = (row.full_name ?? row.name ?? row["full name"] ?? "").trim();
      const email = (row.email ?? row["email address"] ?? "").trim();
      if (!fullName && !email) {
        skipped++;
        errors.push({ row: index + 2, error: "no name and no email" });
        return;
      }
      try {
        const result = createLead(
          workspaceId,
          {
            full_name: fullName || null,
            email: email || null,
            phone: row.phone ?? null,
            job_title: row.job_title ?? row.title ?? null,
            company_name: row.company_name ?? row.company ?? null,
            company_website: row.company_website ?? row.website ?? null,
            linkedin_url: row.linkedin_url ?? row.linkedin ?? null,
            location: row.location ?? null,
            industry: row.industry ?? null,
            company_size: row.company_size ?? row.size ?? null,
            source_id: sourceId,
          },
          { database, actorId: member?.id, origin: "an import" },
        );
        if (result.mergedInto) merged++;
        else imported++;
      } catch (error) {
        skipped++;
        errors.push({ row: index + 2, error: error instanceof Error ? error.message : "could not add this row" });
      }
    });

    database
      .prepare(
        `UPDATE lead_imports SET status = 'completed', imported_rows = ?, merged_rows = ?, skipped_rows = ?,
           error_count = ?, error_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(imported, merged, skipped, errors.length, JSON.stringify(errors.slice(0, 50)), nowIso(), nowIso(), importId);
  });
  run();

  revalidatePath("/sources");
  await revalidateAll();
  return {
    ok: true,
    id: importId,
    message: `${imported} added${merged ? `, ${merged} matched people we already had` : ""}${skipped ? `, ${skipped} skipped` : ""}`,
  };
}

// ---------------------------------------------------------------- settings and jobs

export async function updateWorkspaceAction(patch: Record<string, unknown>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const ws = database.prepare(`SELECT settings_json FROM workspaces WHERE id = ?`).get(workspaceId) as { settings_json: string };
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(ws.settings_json || "{}") as Record<string, unknown>;
  } catch {
    current = {};
  }
  database
    .prepare(`UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify({ ...current, ...patch }), nowIso(), workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: "saved" };
}

export async function toggleRuleAction(ruleId: string, enabled: boolean): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  database.prepare(`UPDATE automation_rules SET is_enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(enabled ? 1 : 0, nowIso(), ruleId, workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: enabled ? "rule turned on" : "rule turned off" };
}

export async function retryJobAction(jobId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const ok = retryJob(database, workspaceId, jobId);
  revalidatePath("/settings");
  return { ok, message: ok ? "queued again" : "that job is not in a failed state" };
}

export async function runJobsNowAction(): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  ensureRecurringJobs(workspaceId, database);
  const digest = buildDigest(workspaceId, undefined, database);
  revalidatePath("/", "layout");
  return { ok: true, message: digest.headline };
}

export async function submitFormAction(formSlug: string, values: Record<string, string>): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const form = database.prepare(`SELECT * FROM capture_forms WHERE workspace_id = ? AND slug = ?`).get(workspaceId, formSlug) as
    | { id: string; name: string; source_id: string | null; campaign_id: string | null }
    | undefined;
  if (!form) return { ok: false, error: "that form does not exist" };

  const result = createLead(
    workspaceId,
    {
      full_name: values.full_name ?? values.name ?? null,
      email: values.email ?? null,
      phone: values.phone ?? null,
      job_title: values.job_title ?? null,
      company_name: values.company_name ?? values.company ?? null,
      notes: values.message ?? values.notes ?? null,
      source_id: form.source_id,
      campaign_id: form.campaign_id,
    },
    { database, actorId: member?.id, origin: `${form.name} form` },
  );

  database.prepare(`UPDATE capture_forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`).run(nowIso(), form.id);
  revalidatePath("/sources");
  await revalidateAll();
  return { ok: true, id: result.mergedInto ?? result.leadId, message: "thanks — we'll be in touch" };
}

// ---------------------------------------------------------------- navigation helpers

export async function goTo(path: string) {
  redirect(path);
}

export { tx };