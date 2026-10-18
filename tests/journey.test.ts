/**
 * the whole journey, start to finish, against a real database.
 * this is the promise the product makes, checked in one go:
 *   a lead arrives, gets contacted, replies, gets a task, books a meeting,
 *   becomes an opportunity, converts, and every dashboard number follows.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";

import { openDb } from "../src/lib/db/client";
import { nowIso, daysAgoIso, hoursFromNow } from "../src/lib/db/time";
import { createLead, getLead } from "../src/lib/queries/leads";
import { logInboundMessage, logOutboundMessage } from "../src/lib/queries/outreach";
import { completeTask, createTask, queryTasks, taskCounts } from "../src/lib/queries/tasks";
import { bookMeeting, createOpportunity, updateOpportunity } from "../src/lib/queries/deals";
import { createSequence, enrollLead } from "../src/lib/queries/nurture";
import { createSource } from "../src/lib/queries/sources";
import { conversionFunnel, overview, stageBreakdown, trends } from "../src/lib/queries/analytics";
import { enqueue, runOne } from "../src/lib/jobs/queue";
import "../src/lib/jobs/handlers";

let db: any;
let workspaceId: string;
let memberId: string;
let sourceId: string;
let sequenceId: string;

before(() => {
  db = openDb(process.env.LEADFLOW_DB_PATH);
  const now = nowIso();
  workspaceId = "ws_journey";
  db.prepare(`INSERT INTO workspaces (id,name,slug,timezone,settings_json,created_at,updated_at) VALUES (?,'journey','journey','utc','{}',?,?)`).run(
    workspaceId,
    now,
    now,
  );
  memberId = "mem_journey";
  db.prepare(`INSERT INTO members (id,workspace_id,name,email,role,avatar_hue,created_at,updated_at) VALUES (?,?,?,?,'owner',262,?,?)`).run(
    memberId,
    workspaceId,
    "rhea kapoor",
    "rhea@journey.test",
    now,
    now,
  );
  sourceId = createSource(workspaceId, { name: "website signup", kind: "form" }, db);
  sequenceId = createSequence(
    workspaceId,
    { name: "short introduction", steps: [{ name: "first", subject: "quick question", content: "hi", waitDays: 0 }] },
    db,
  );
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${process.env.LEADFLOW_DB_PATH}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe("a lead's whole life", () => {
  let leadId: string;

  it("1. arrives from the website and lands in the inbox", () => {
    const result = createLead(
      workspaceId,
      {
        full_name: "jane rivers",
        email: "jane@acme.io",
        company_name: "acme",
        company_website: "acme.io",
        job_title: "head of growth",
        source_id: sourceId,
        owner_id: memberId,
      },
      { database: db, actorId: memberId, origin: "the website" },
    );
    leadId = result.leadId;
    assert.ok(leadId);

    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.is_new, 1, "nobody has looked at them yet");
    assert.equal(lead.pipeline_stage, "new");
    assert.equal(lead.outreach_state, "never_contacted");
    assert.equal(lead.nurture_state, "not_enrolled");
    assert.equal(lead.owner_name, "rhea kapoor", "they were assigned to someone");

    const inbox = overview(workspaceId, "all", undefined, undefined, db);
    assert.equal(inbox.newUnprocessed, 1, "the inbox knows about them");
  });

  it("2. someone reads them, so they leave the inbox", () => {
    const taskId = createTask({ workspaceId, leadId, title: "look this person up", type: "research", ownerId: memberId }, { actorId: memberId, database: db })!;
    assert.equal(getLead(db, workspaceId, leadId)!.is_new, 0, "creating a task counts as touching them");
    completeTask(db, workspaceId, taskId, memberId);
    assert.equal(taskCounts(workspaceId, undefined, db).completed >= 1, true);
  });

  it("3. outreach goes out and lands in awaiting reply, never replied", () => {
    logOutboundMessage(
      db,
      { workspaceId, leadId, content: "hi jane, quick question", subject: "quick question", followUpAfterDays: 3, owner_id: memberId },
      memberId,
    );
    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.outreach_state, "follow_up_scheduled", "we asked for a follow-up, so it is scheduled");
    assert.notEqual(lead.outreach_state, "replied", "sending is not a reply");
    assert.equal(lead.pipeline_stage, "contacted");
    assert.ok(lead.next_follow_up_at);
  });

  it("4. they reply, and the follow-up clock stops", () => {
    logInboundMessage(db, { workspaceId, leadId, content: "yes, tell me more" }, memberId);
    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.outreach_state, "replied");
    assert.equal(lead.pipeline_stage, "engaged");
    assert.equal(lead.reply_count, 1);
    assert.equal(lead.next_follow_up_at, null, "they answered, so nothing is chasing them");
  });

  it("5. a meeting gets booked, along with the prep task", () => {
    bookMeeting(
      db,
      { workspaceId, leadId, title: "intro call", scheduledAt: hoursFromNow(26), ownerId: memberId, createPrepTask: true },
      memberId,
    );
    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.pipeline_stage, "meeting_booked");
    assert.equal(lead.meeting_count, 1);

    const prep = queryTasks(workspaceId, { leadId, bucket: "all" }, db).rows.find((t: any) => t.type === "research");
    assert.ok(prep, "a prep task was created with it");
  });

  it("6. they can be nurtured at the same time as all of the above", () => {
    enrollLead(db, workspaceId, leadId, sequenceId, { actorId: memberId });
    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.nurture_state, "nurturing");
    assert.equal(lead.outreach_state, "replied", "nurture does not overwrite outreach");
    assert.equal(lead.pipeline_stage, "meeting_booked", "nurture does not move the funnel");
  });

  it("7. an opportunity opens, then is won", () => {
    const oppId = createOpportunity(
      db,
      { workspaceId, leadId, name: "acme — annual plan", amount: 6000, stage: "proposal", ownerId: memberId },
      memberId,
    );
    assert.equal(getLead(db, workspaceId, leadId)!.pipeline_stage, "opportunity");

    updateOpportunity(db, workspaceId, oppId, { stage: "won" }, memberId);
    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.pipeline_stage, "converted");
    assert.ok(lead.converted_at, "the win is dated");
  });

  it("8. every dashboard number moved with it", () => {
    const stats = overview(workspaceId, "all", undefined, undefined, db);
    assert.equal(stats.totalLeads, 1);
    assert.equal(stats.contacted, 1);
    assert.equal(stats.replied, 1);
    assert.equal(stats.converted, 1);
    assert.equal(stats.conversionRate, 100, "one lead, one conversion");
    assert.equal(stats.wonValue, 6000);
    assert.equal(stats.nurturing, 1);
    assert.equal(stats.newUnprocessed, 0);
    assert.equal(stats.meetingsBooked, 1);

    const stages = stageBreakdown(workspaceId, "all", undefined, db);
    assert.equal(stages.find((s) => s.stage === "converted")!.count, 1);

    const funnel = conversionFunnel(workspaceId, "all", undefined, db);
    assert.equal(funnel[0].count, 1, "acquired");
    assert.equal(funnel[1].count, 1, "contacted");
    assert.equal(funnel[2].count, 1, "replied");
    assert.equal(funnel[3].count, 1, "met");
    assert.equal(funnel[4].count, 1, "opportunity");
    assert.equal(funnel[5].count, 1, "converted");

    assert.ok(trends(workspaceId, "all", undefined, db).length > 1, "there is a movement series to draw");
  });

  it("9. their timeline tells the whole story in order", () => {
    // rowid is the tiebreaker, because several of these land in the same millisecond
    const events = db
      .prepare(`SELECT type FROM activity_events WHERE lead_id = ? ORDER BY occurred_at ASC, created_at ASC, rowid ASC`)
      .all(leadId) as Array<{ type: string }>;
    const types = events.map((e) => e.type);
    assert.ok(types.includes("lead_created"));
    assert.ok(types.includes("message_sent"));
    assert.ok(types.includes("message_replied"));
    assert.ok(types.includes("meeting_booked"));
    assert.ok(types.includes("nurture_enrolled"));
    assert.ok(types.includes("opportunity_created"));
    assert.ok(types.includes("opportunity_won"));
    assert.ok(types.indexOf("lead_created") < types.indexOf("message_sent"));
    assert.ok(types.indexOf("message_sent") < types.indexOf("message_replied"));
  });
});

describe("the same person arriving twice", () => {
  it("folds into one record without losing anything", () => {
    const original = createLead(
      workspaceId,
      { full_name: "omar khalid", email: "omar@robotics.ai", company_name: "robotics", company_website: "robotics.ai" },
      { database: db, actorId: memberId },
    );
    logOutboundMessage(db, { workspaceId, leadId: original.leadId, content: "first contact" }, memberId);

    // the same address arriving from a second source is certain: it merges
    const again = createLead(
      workspaceId,
      { full_name: "Omar Khalid", email: "omar+import@robotics.ai", company_name: "robotics ai", company_website: "www.robotics.ai", source_id: sourceId },
      { database: db, actorId: memberId, origin: "an import" },
    );

    assert.equal(again.mergedInto, original.leadId);
    assert.equal(again.reviewCount, 0, "a certain match does not need a human");

    // same name at the same company but a different inbox is not certain: ask
    const maybe = createLead(
      workspaceId,
      { full_name: "Omar Khalid", email: "omar.khalid@robotics.ai", company_name: "robotics ai", company_website: "robotics.ai", source_id: sourceId },
      { database: db, actorId: memberId, origin: "an import" },
    );
    assert.equal(maybe.mergedInto, undefined, "a different inbox at the same company is not proof");
    assert.ok(maybe.reviewCount > 0, "so it goes to the review queue");

    const survivor = getLead(db, workspaceId, original.leadId)!;
    assert.equal(survivor.outbound_count, 1, "the first contact is still there");

    const attributed = db.prepare(`SELECT COUNT(*) AS n FROM lead_attributions WHERE lead_id = ?`).get(original.leadId) as { n: number };
    assert.ok(attributed.n >= 1, "sources are kept");
  });

  it("asks a human when it is not sure", () => {
    const first = createLead(
      workspaceId,
      { full_name: "lena park", email: "lena.park@clinic.com", company_name: "clinic", company_website: "clinic.com" },
      { database: db, actorId: memberId },
    );
    const second = createLead(
      workspaceId,
      { full_name: "lena park", email: "l.park@clinic.com", company_name: "clinic", company_website: "clinic.com" },
      { database: db, actorId: memberId },
    );
    assert.equal(second.mergedInto, undefined, "not merged without being sure");
    assert.ok(second.reviewCount > 0, "queued for review instead");

    const queued = db.prepare(`SELECT COUNT(*) AS n FROM dupe_candidates WHERE status = 'pending' AND lead_id = ?`).get(second.createdId) as { n: number };
    assert.equal(queued.n, 1, "the pair appears exactly once in the queue");
    assert.equal(first.leadId !== second.leadId, true);
  });
});

describe("the background worker", () => {
  it("sends a due nurture step and records it as outreach", async () => {
    const lead = createLead(
      workspaceId,
      { full_name: "tess oduya", email: "tess@nurtureme.com", company_name: "nurture me", company_website: "nurtureme.com" },
      { database: db, actorId: memberId },
    );
    enrollLead(db, workspaceId, lead.leadId, sequenceId, { actorId: memberId });
    // pull the step forward so it is due right now
    db.prepare(`UPDATE nurture_steps SET scheduled_at = ? WHERE lead_id = ? AND status = 'pending'`).run(daysAgoIso(1), lead.leadId);

    enqueue({ workspaceId, kind: "nurture_dispatch", payload: { workspaceId }, idempotencyKey: `nur-${Date.now()}` }, db);
    await runOne("journey-worker", ["nurture_dispatch"], db);

    const messages = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE lead_id = ?`).get(lead.leadId) as { n: number };
    assert.equal(messages.n, 1, "the step went out as a real message");

    const after1 = getLead(db, workspaceId, lead.leadId)!;
    assert.equal(after1.outreach_state, "awaiting_reply");
    assert.equal(after1.nurture_state, "nurturing");

    // running the same job again must not send the same step twice
    enqueue({ workspaceId, kind: "nurture_dispatch", payload: { workspaceId }, idempotencyKey: `nur2-${Date.now()}` }, db);
    await runOne("journey-worker", ["nurture_dispatch"], db);
    const messages2 = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE lead_id = ?`).get(lead.leadId) as { n: number };
    assert.equal(messages2.n, 1, "a sent step is not sent again");
  });

  it("turns overdue work into real tasks, once each", async () => {
    const lead = createLead(
      workspaceId,
      { full_name: "vera stone", email: "vera@sweep.com", company_name: "sweep", company_website: "sweep.com" },
      { database: db, actorId: memberId },
    );
    createTask({ workspaceId, leadId: lead.leadId, title: "call vera", type: "call", dueAt: daysAgoIso(2), ownerId: memberId }, { actorId: memberId, database: db });

    const swept = () =>
      (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND dedupe_key LIKE 'sweep:2026-01-01:%'`).get(workspaceId) as { n: number }).n;

    const before = swept();
    assert.equal(before, 0);

    enqueue({ workspaceId, kind: "follow_up_sweep", payload: { workspaceId, day: "2026-01-01" }, idempotencyKey: `sweep1-${Date.now()}` }, db);
    await runOne("journey-worker", ["follow_up_sweep"], db);
    const afterFirst = swept();
    assert.ok(afterFirst > before, "overdue work became a task");

    // run it again for the same day
    enqueue({ workspaceId, kind: "follow_up_sweep", payload: { workspaceId, day: "2026-01-01" }, idempotencyKey: `sweep2-${Date.now()}` }, db);
    await runOne("journey-worker", ["follow_up_sweep"], db);

    // no key was ever used twice, so nothing is being worked twice
    const duplicates = db
      .prepare(`SELECT dedupe_key, COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND dedupe_key IS NOT NULL GROUP BY dedupe_key HAVING n > 1`)
      .all(workspaceId) as Array<{ dedupe_key: string; n: number }>;
    assert.deepEqual(duplicates, [], "no task was created twice for the same thing");
    assert.ok(swept() >= afterFirst, "work already queued is not duplicated");
  });
});