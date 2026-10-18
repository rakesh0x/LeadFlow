/**
 * the rules the product actually promises, checked against a throwaway database.
 * run with `npm test`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";

import { openDb } from "../src/lib/db/client";
import { nowIso, daysAgoIso, hoursFromNow } from "../src/lib/db/time";
import * as normalize from "../src/lib/engine/normalize";
import { deriveStates } from "../src/lib/engine/states";
import { findMatches, AUTO_MERGE_CONFIDENCE } from "../src/lib/engine/dedupe";
import { mergeLeads } from "../src/lib/engine/merge";
import { recordEvent } from "../src/lib/engine/events";
import * as leads from "../src/lib/queries/leads";
import * as outreach from "../src/lib/queries/outreach";
import * as tasks from "../src/lib/queries/tasks";
import * as analytics from "../src/lib/queries/analytics";
import { enqueue, runOne, jobSummary } from "../src/lib/jobs/queue";

let db: any;
let workspaceId: string;

before(() => {
  db = openDb(process.env.LEADFLOW_DB_PATH);
  workspaceId = "ws_test";
  db.prepare(
    `INSERT INTO workspaces (id, name, slug, timezone, settings_json, created_at, updated_at)
     VALUES (?, 'test', 'test', 'utc', '{}', ?, ?)`,
  ).run(workspaceId, nowIso(), nowIso());
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${process.env.LEADFLOW_DB_PATH}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

function newLead(overrides: Record<string, unknown> = {}, options: { skipDedupe?: boolean } = {}) {
  return leads.createLead(workspaceId, { full_name: "test person", ...overrides } as never, {
    database: db,
    skipDedupe: options.skipDedupe ?? true,
  });
}

// ---------------------------------------------------------------- normalisation

describe("normalisation", () => {
  it("treats gmail dots and plus tags as the same person", () => {
    assert.equal(normalize.normalizeEmail("Jane.Doe+x@gmail.com"), normalize.normalizeEmail("janedoe@gmail.com"));
  });

  it("drops country codes and leading zeros from phone numbers", () => {
    assert.equal(normalize.normalizePhone("+1 (415) 555-0100"), normalize.normalizePhone("0415 555 0100"));
  });

  it("reduces linkedin urls to the profile key", () => {
    assert.equal(normalize.normalizeLinkedin("https://www.linkedin.com/in/Jane-Doe/?utm_source=x"), "linkedin:jane-doe");
  });

  it("keeps the registrable part of a company domain", () => {
    assert.equal(normalize.normalizeDomain("https://mail.acme.co.uk/team"), "acme.co.uk");
  });

  it("does not treat free mail as a company", () => {
    assert.equal(normalize.companyDomainFromEmail("jane@gmail.com"), null);
    assert.equal(normalize.companyDomainFromEmail("jane@acme.com"), "acme.com");
  });

  it("builds the same name key whatever the person is called", () => {
    assert.equal(normalize.nameKey("Dr. Jane de Vries"), normalize.nameKey("jane de vries"));
  });
});

// ---------------------------------------------------------------- state derivation

describe("lead states", () => {
  const base: Parameters<typeof deriveStates>[0] = {
    id: "l1",
    pipeline_stage: "new",
    outreach_state: "never_contacted",
    nurture_state: "not_enrolled",
    pipeline_stage_set_by: "auto",
    outreach_state_set_by: "auto",
    nurture_state_set_by: "auto",
    last_activity_at: null,
  };
  const noMessages = { lastOutbound: null, lastInbound: null, outboundCount: 0, inboundCount: 0, followUpAt: null };
  const noTasks = { dueFollowUp: false, scheduledFollowUp: null };
  const noNurture = { state: null as null, reengageDue: false, lastStepAt: null };

  it("starts untouched", () => {
    const out = deriveStates(base, noMessages, noTasks, noNurture);
    assert.equal(out.outreachState, "never_contacted");
    assert.equal(out.nurtureState, "not_enrolled");
  });

  it("sending a message is never a reply", () => {
    const out = deriveStates(base, { ...noMessages, lastOutbound: nowIso(), outboundCount: 1 }, noTasks, noNurture);
    assert.notEqual(out.outreachState, "replied");
    assert.equal(out.outreachState, "awaiting_reply");
    assert.equal(out.pipelineStage, "contacted");
  });

  it("an inbound message is what makes them replied", () => {
    const out = deriveStates(
      base,
      { lastOutbound: daysAgoIso(2), lastInbound: daysAgoIso(1), outboundCount: 1, inboundCount: 1, followUpAt: null },
      noTasks,
      noNurture,
    );
    assert.equal(out.outreachState, "replied");
    assert.equal(out.pipelineStage, "engaged");
  });

  it("a reply in the same instant as our message still counts", () => {
    const same = nowIso();
    const out = deriveStates(
      base,
      { lastOutbound: same, lastInbound: same, outboundCount: 1, inboundCount: 1, followUpAt: null },
      noTasks,
      noNurture,
    );
    assert.equal(out.outreachState, "replied", "they answered, even at the same timestamp");
  });

  it("a real exchange is a conversation", () => {
    const out = deriveStates(
      base,
      { lastOutbound: daysAgoIso(4), lastInbound: daysAgoIso(1), outboundCount: 2, inboundCount: 2, followUpAt: null },
      noTasks,
      noNurture,
    );
    assert.equal(out.outreachState, "conversation_active");
  });

  it("going last still leaves them awaiting our answer", () => {
    const out = deriveStates(
      base,
      { lastOutbound: daysAgoIso(1), lastInbound: daysAgoIso(4), outboundCount: 2, inboundCount: 2, followUpAt: null },
      noTasks,
      noNurture,
    );
    assert.equal(out.outreachState, "awaiting_reply");
  });

  it("nurture and outreach are independent", () => {
    const nurturing = deriveStates(base, noMessages, noTasks, { ...noNurture, state: "active" });
    assert.equal(nurturing.nurtureState, "nurturing");
    assert.notEqual(nurturing.outreachState, "replied");

    const both = deriveStates(
      { ...base, nurture_state: "nurturing" as const },
      { lastOutbound: daysAgoIso(3), lastInbound: daysAgoIso(2), outboundCount: 1, inboundCount: 1, followUpAt: null },
      noTasks,
      { ...noNurture, state: "active" },
    );
    assert.equal(both.outreachState, "replied");
    assert.equal(both.nurtureState, "nurturing");
  });

  it("never walks itself backwards through the funnel", () => {
    const engaged: Parameters<typeof deriveStates>[0] = { ...base, pipeline_stage: "engaged", outreach_state: "replied" };
    const out = deriveStates(engaged, { lastOutbound: null, lastInbound: daysAgoIso(5), outboundCount: 0, inboundCount: 1, followUpAt: null }, noTasks, noNurture);
    assert.equal(out.pipelineStage, "engaged");
  });

  it("leaves a state alone once a person sets it by hand", () => {
    const pinned: Parameters<typeof deriveStates>[0] = { ...base, pipeline_stage: "qualified", pipeline_stage_set_by: "manual" };
    const out = deriveStates(pinned, { ...noMessages, lastOutbound: nowIso(), outboundCount: 3 }, noTasks, noNurture);
    assert.equal(out.pipelineStage, "qualified");
  });

  it("flags a finished sequence for re-engagement once it goes quiet", () => {
    const out = deriveStates(base, noMessages, noTasks, {
      state: "completed",
      reengageDue: false,
      lastStepAt: daysAgoIso(45),
    });
    assert.equal(out.nurtureState, "ready_for_reengagement");
  });
});

// ---------------------------------------------------------------- duplicates

describe("duplicate detection", () => {
  it("matches the same person arriving from two sources", () => {
    const a = newLead({ full_name: "sam rivers", email: "sam@acme.io", company_name: "acme", company_website: "acme.io" });
    const matches = findMatches(db, workspaceId, { full_name: "sam rivers", email: "sam@acme.io" }, [a.leadId]);
    const withOther = findMatches(db, workspaceId, { full_name: "sam rivers", email: "sam@acme.io" });
    assert.ok(withOther.some((m) => m.leadId === a.leadId && m.confidence >= AUTO_MERGE_CONFIDENCE));
    void matches;
  });

  it("does not confuse two different people at one company", () => {
    newLead({ full_name: "alex kim", email: "alex@bigco.com", company_name: "bigco", company_website: "bigco.com" });
    newLead({ full_name: "robin banks", email: "robin@bigco.com", company_name: "bigco", company_website: "bigco.com" });
    const matches = findMatches(db, workspaceId, { full_name: "robin banks", email: "robin@bigco.com" });
    assert.equal(matches.filter((m) => m.fullName === "alex kim").length, 0);
  });

  it("never folds a record into itself", () => {
    const self = newLead({ full_name: "zoe quinn", email: "zoe@selfco.com" });
    const merged = leads.createLead(workspaceId, { full_name: "zoe quinn", email: "zoe.quinn@selfco.com" }, { database: db });
    const row = db.prepare(`SELECT merged_into_lead_id FROM leads WHERE id = ?`).get(merged.leadId) as { merged_into_lead_id: string | null };
    assert.notEqual(row.merged_into_lead_id, merged.leadId, "a record must never point at itself");
    assert.ok(self.leadId !== merged.leadId);
  });

  it("auto-merges a certain match and keeps every source and message", () => {
    const original = newLead({ full_name: "kit morgan", email: "kit@dupe.com", company_name: "dupe", company_website: "dupe.com" });
    outreach.logOutboundMessage(db, { workspaceId, leadId: original.leadId, content: "hello", campaign_id: null }, null);
    tasks.createTask({ workspaceId, leadId: original.leadId, title: "call kit" }, { database: db });

    const incoming = leads.createLead(
      workspaceId,
      { full_name: "Kit Morgan", email: "kit+work@dupe.com", company_name: "dupe", company_website: "dupe.com", notes: "from the ads" },
      { database: db },
    );

    assert.equal(incoming.mergedInto, original.leadId, "the incoming record should have folded into the existing one");
    assert.equal(incoming.leadId, original.leadId, "everything downstream should link to the surviving record");

    const merged = db.prepare(`SELECT merged_into_lead_id FROM leads WHERE id = ?`).get(incoming.createdId) as { merged_into_lead_id: string | null };
    assert.equal(merged.merged_into_lead_id, original.leadId, "the old row is kept and points at the survivor");

    const survivor = leads.getLead(db, workspaceId, original.leadId)!;
    assert.equal(survivor.notes, "from the ads", "the survivor keeps what it was missing");
    assert.equal(survivor.outbound_count, 1, "the message moved across");
  });

  it("keeps an ambiguous match for review instead of merging", () => {
    newLead({ full_name: "lena park", email: "lena.park@clinic.com", company_name: "clinic", company_website: "clinic.com" });
    const result = leads.createLead(
      workspaceId,
      { full_name: "lena park", email: "l.park@clinic.com", company_name: "clinic", company_website: "clinic.com" },
      { database: db },
    );
    assert.ok(result.reviewCount > 0, "an unclear match should be queued for review, not merged");
    assert.equal(result.mergedInto, undefined);
  });

  it("records the merge so it can be explained later", () => {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM lead_merges WHERE workspace_id = ?`).get(workspaceId) as { n: number };
    assert.ok(count.n > 0);
  });
});

// ---------------------------------------------------------------- merging

describe("merging two records", () => {
  it("moves every interaction and keeps the earliest date", () => {
    const a = newLead({ full_name: "merge one", email: "m1@merge.com" });
    const b = newLead({ full_name: "merge two", email: "m2@merge.com" });
    outreach.logOutboundMessage(db, { workspaceId, leadId: a.leadId, content: "to a" }, null);
    outreach.logOutboundMessage(db, { workspaceId, leadId: b.leadId, content: "to b" }, null);
    recordEvent(db, { workspaceId, leadId: b.leadId, type: "note_added", title: "note", occurredAt: daysAgoIso(30) });
    db.prepare(`UPDATE leads SET created_at = ? WHERE id = ?`).run(daysAgoIso(30), b.leadId);

    const result = mergeLeads(db, workspaceId, a.leadId, b.leadId, null, "test");
    assert.equal(result.ok, true);

    const messages = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE lead_id = ?`).get(a.leadId) as { n: number };
    assert.equal(messages.n, 2, "both messages now live on one record");

    const events = db.prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE lead_id = ?`).get(a.leadId) as { n: number };
    assert.ok(events.n >= 2);

    const survivor = leads.getLead(db, workspaceId, a.leadId)!;
    assert.equal(
      survivor.created_at.slice(0, 10),
      daysAgoIso(30).slice(0, 10),
      "the older creation date wins so new vs old stays honest",
    );
  });

  it("refuses to merge a record into itself", () => {
    const a = newLead({ full_name: "self merge", email: "self@merge.com" });
    const result = mergeLeads(db, workspaceId, a.leadId, a.leadId);
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------- outreach

describe("outreach recording", () => {
  it("moves a lead to awaiting reply when we send", () => {
    const lead = newLead({ full_name: "sent one", email: "sent@outreach.com" });
    outreach.logOutboundMessage(db, { workspaceId, leadId: lead.leadId, content: "hello there" }, null);
    const after = leads.getLead(db, workspaceId, lead.leadId)!;
    assert.equal(after.outreach_state, "awaiting_reply");
    assert.equal(after.pipeline_stage, "contacted");
    assert.equal(after.reply_count, 0);
  });

  it("marks them replied and clears the follow-up clock when they answer", () => {
    const lead = newLead({ full_name: "replied one", email: "replied@outreach.com" });
    const messageId = outreach.logOutboundMessage(
      db,
      { workspaceId, leadId: lead.leadId, content: "hello", followUpAfterDays: 3 },
      null,
    );
    let row = leads.getLead(db, workspaceId, lead.leadId)!;
    assert.ok(row.next_follow_up_at, "a follow-up was scheduled");

    outreach.logInboundMessage(db, { workspaceId, leadId: lead.leadId, content: "yes, tell me more", inReplyToMessageId: messageId }, null);
    row = leads.getLead(db, workspaceId, lead.leadId)!;
    assert.equal(row.outreach_state, "replied");
    assert.equal(row.pipeline_stage, "engaged");
    assert.equal(row.next_follow_up_at, null);
    assert.equal(row.reply_count, 1);
  });

  it("turns a due task into a follow-up state", () => {
    const lead = newLead({ full_name: "due one", email: "due@outreach.com" });
    outreach.logOutboundMessage(db, { workspaceId, leadId: lead.leadId, content: "hello" }, null);
    tasks.createTask(
      { workspaceId, leadId: lead.leadId, title: "chase", type: "follow_up", dueAt: daysAgoIso(1) },
      { database: db },
    );
    assert.equal(leads.getLead(db, workspaceId, lead.leadId)!.outreach_state, "follow_up_due");
  });
});

// ---------------------------------------------------------------- tasks

describe("tasks", () => {
  it("completing a task writes to the timeline and refreshes the lead", () => {
    const lead = newLead({ full_name: "task one", email: "task@tasks.com" });
    const taskId = tasks.createTask({ workspaceId, leadId: lead.leadId, title: "send the proposal" }, { database: db })!;

    const event = db.prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE lead_id = ? AND type = 'task_completed'`).get(lead.leadId) as { n: number };
    assert.equal(event.n, 0);

    assert.equal(tasks.completeTask(db, workspaceId, taskId, null), true);

    const after = db.prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE lead_id = ? AND type = 'task_completed'`).get(lead.leadId) as { n: number };
    assert.equal(after.n, 1, "the timeline records it");

    const updated = leads.getLead(db, workspaceId, lead.leadId)!;
    assert.ok(updated.first_touched_at, "the lead counts as touched");
  });

  it("will not create the same task twice when given the same key", () => {
    const lead = newLead({ full_name: "task two", email: "task2@tasks.com" });
    const first = tasks.createTask({ workspaceId, leadId: lead.leadId, title: "chase", dedupeKey: "sweep:2024-01-01:abc" }, { database: db });
    const second = tasks.createTask({ workspaceId, leadId: lead.leadId, title: "chase", dedupeKey: "sweep:2024-01-01:abc" }, { database: db });
    assert.equal(first, second, "the dedupe key returns the existing task");

    const count = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE dedupe_key = ?`).get("sweep:2024-01-01:abc") as { n: number };
    assert.equal(count.n, 1);
  });

  it("buckets tasks into today, overdue and upcoming", () => {
    tasks.createTask({ workspaceId, title: "late one", dueAt: daysAgoIso(3) }, { database: db });
    tasks.createTask({ workspaceId, title: "soon one", dueAt: hoursFromNow(2) }, { database: db });
    assert.ok(tasks.taskCounts(workspaceId, undefined, db).overdue >= 1);
    assert.ok(tasks.taskCounts(workspaceId, undefined, db).upcoming >= 1);
  });
});

// ---------------------------------------------------------------- analytics

describe("dashboard numbers", () => {
  it("counts only real records", () => {
    const stats = analytics.overview(workspaceId, "all", undefined, undefined, db);
    const actual = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE workspace_id = ? AND merged_into_lead_id IS NULL AND is_archived = 0`).get(workspaceId) as { n: number };
    assert.equal(stats.totalLeads, actual.n);
  });

  it("excludes merged records from every count", () => {
    const a = newLead({ full_name: "count a", email: "ca@count.com" });
    const b = newLead({ full_name: "count b", email: "cb@count.com" });
    mergeLeads(db, workspaceId, a.leadId, b.leadId);

    const actual = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE workspace_id = ? AND merged_into_lead_id IS NULL AND is_archived = 0`).get(workspaceId) as { n: number };
    assert.equal(analytics.overview(workspaceId, "all", undefined, undefined, db).totalLeads, actual.n);
  });

  it("answers the questions the product promises", () => {
    const answers = analytics.quickAnswers(workspaceId, "all", db);
    const questions = answers.map((a) => a.question);
    for (const expected of [
      "how many leads do we have?",
      "how many are new?",
      "which leads are new and not converted yet?",
      "which leads haven't replied to us?",
      "which leads haven't been nurtured?",
      "how many have converted?",
    ]) {
      assert.ok(questions.includes(expected), `missing question: ${expected}`);
    }
    for (const answer of answers) assert.equal(typeof answer.count, "number");
  });
});

// ---------------------------------------------------------------- jobs

describe("background jobs", () => {
  it("never queues the same idempotency key twice", () => {
    const key = `test-idem-${Date.now()}`;
    const first = enqueue({ workspaceId, kind: "follow_up_sweep", payload: {}, idempotencyKey: key }, db);
    const second = enqueue({ workspaceId, kind: "follow_up_sweep", payload: {}, idempotencyKey: key }, db);
    assert.equal(first, second);
  });

  it("runs a job and records the attempt", async () => {
    enqueue({ workspaceId, kind: "state_refresh", payload: { workspaceId }, idempotencyKey: `run-${Date.now()}` }, db);
    const ran = await runOne("test-worker", undefined, db);
    assert.equal(ran, true);

    const runs = db.prepare(`SELECT COUNT(*) AS n FROM job_runs WHERE workspace_id = ?`).get(workspaceId) as { n: number };
    assert.ok(runs.n > 0);
  });

  it("retries a failing job and eventually gives up", async () => {
    await import("../src/lib/jobs/handlers");
    const id = newJobIdLocal();
    db.prepare(
      `INSERT INTO jobs (id, workspace_id, kind, payload_json, status, priority, run_at, max_attempts, created_at, updated_at)
       VALUES (?,?, 'nonsense_kind', '{}', 'pending', 1, ?, 1, ?, ?)`,
    ).run(id, workspaceId, nowIso(), nowIso(), nowIso());

    await runOne("test-worker", ["nonsense_kind"], db);
    const row = db.prepare(`SELECT status, attempts FROM jobs WHERE id = ?`).get(id) as { status: string; attempts: number };
    assert.equal(row.status, "failed", "an unknown job kind fails immediately rather than retrying forever");
    assert.equal(row.attempts, 1);
  });

  it("summarises the queue", () => {
    const summary = jobSummary(workspaceId, db);
    assert.ok(typeof summary.pending === "number");
    assert.ok(summary.pending >= 0);
  });
});

function newJobIdLocal(): string {
  return `job_test_${Math.random().toString(36).slice(2, 12)}`;
}