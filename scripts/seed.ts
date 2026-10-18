/**
 * seeds a workspace that looks like a real one.
 * the numbers here are made up, but every relationship between them is genuine:
 * events produce states, states produce dashboard counts, duplicates really collide.
 */
import { openDb } from "../src/lib/db/client";
import { newCompanyId, newFormId, newMemberId, newWorkspaceId } from "../src/lib/db/ids";
import { addMs, daysAgoIso, nowIso } from "../src/lib/db/time";
import { recordEvent } from "../src/lib/engine/events";
import { recomputeLeadStates } from "../src/lib/engine/states";
import { createLead, setStage, setOutreachState } from "../src/lib/queries/leads";
import { createTask, completeTask } from "../src/lib/queries/tasks";
import { bookMeeting, createOpportunity, updateOpportunity } from "../src/lib/queries/deals";
import { createCampaign, logInboundMessage, logOutboundMessage, setMessageFollowUp } from "../src/lib/queries/outreach";
import { createSequence, enrollLead } from "../src/lib/queries/nurture";
import { createForm, createSource, linkAttribution } from "../src/lib/queries/sources";
import { enqueue } from "../src/lib/jobs/queue";
import { ensureRecurringJobs } from "../src/lib/jobs/scheduler";
import "../src/lib/jobs/handlers";

// ---------------------------------------------------------------- people

const TEAM = [
  { name: "rhea kapoor", email: "rhea@leadflow.test", role: "owner" as const, title: "founder", hue: 262 },
  { name: "tom ilves", email: "tom@leadflow.test", role: "member" as const, title: "sales", hue: 199 },
  { name: "nadia osei", email: "nadia@leadflow.test", role: "member" as const, title: "sales", hue: 152 },
  { name: "jonas berg", email: "jonas@leadflow.test", role: "member" as const, title: "growth", hue: 24 },
];

const COMPANIES = [
  { name: "northwind labs", domain: "northwindlabs.com", industry: "developer tools", size: "51-200", location: "portland, us" },
  { name: "helios freight", domain: "heliosfreight.com", industry: "logistics", size: "201-500", location: "rotterdam, nl" },
  { name: "cobalt health", domain: "cobalthealth.io", industry: "healthtech", size: "11-50", location: "boston, us" },
  { name: "pinecone retail", domain: "pineconeretail.com", industry: "ecommerce", size: "501-1000", location: "toronto, ca" },
  { name: "lumen studio", domain: "lumenstudio.design", industry: "design", size: "2-10", location: "berlin, de" },
  { name: "atlas robotics", domain: "atlasrobotics.ai", industry: "hardware", size: "51-200", location: "tokyo, jp" },
  { name: "quiet river", domain: "quietriver.co", industry: "finance", size: "11-50", location: "london, uk" },
  { name: "sable media", domain: "sablemedia.co", industry: "media", size: "2-10", location: "melbourne, au" },
  { name: "meridian foods", domain: "meridianfoods.com", industry: "food", size: "201-500", location: "dublin, ie" },
  { name: "arc light energy", domain: "arclightenergy.com", industry: "energy", size: "501-1000", location: "austin, us" },
];

const PEOPLE = [
  { name: "mira vasquez", title: "head of growth", company: 0, linkedin: "https://linkedin.com/in/miravasquez", x: "https://x.com/mirav", loc: "portland, us", replies: 3, meets: 1, converts: false },
  { name: "devon price", title: "vp engineering", company: 0, linkedin: "https://linkedin.com/in/devonprice", replies: 1, meets: 0, converts: false },
  { name: "sanne de vries", title: "ops director", company: 1, replies: 2, meets: 1, converts: true },
  { name: "kwame asante", title: "cto", company: 2, linkedin: "https://linkedin.com/in/kwameasante", replies: 2, meets: 1, converts: true },
  { name: "priya raman", title: "founder", company: 2, replies: 1, meets: 0, converts: false },
  { name: "tomas eriksen", title: "supply chain lead", company: 1, replies: 0, meets: 0, converts: false },
  { name: "lila nguyen", title: "product designer", company: 4, x: "https://x.com/lilabuilds", replies: 1, meets: 0, converts: false },
  { name: "omar haddad", title: "ceo", company: 5, replies: 3, meets: 1, converts: true },
  { name: "jess morrow", title: "marketing manager", company: 3, replies: 1, meets: 0, converts: false },
  { name: "felix brandt", title: "engineering lead", company: 6, replies: 0, meets: 0, converts: false },
  { name: "rosa quintero", title: "partnerships", company: 8, replies: 2, meets: 1, converts: true },
  { name: "ian mccabe", title: "head of revenue", company: 9, linkedin: "https://linkedin.com/in/ianmccabe", replies: 2, meets: 1, converts: true },
  { name: "hana kovacs", title: "product manager", company: 7, replies: 1, meets: 0, converts: false },
  { name: "peter noland", title: "sales lead", company: 7, replies: 0, meets: 0, converts: false },
  { name: "amara obi", title: "data lead", company: 3, replies: 1, meets: 0, converts: false },
  { name: "yuki tanaka", title: "hardware lead", company: 5, replies: 2, meets: 1, converts: false },
  { name: "clara jensen", title: "founder", company: 4, replies: 0, meets: 0, converts: false },
  { name: "dmitri volkov", title: "ops manager", company: 8, replies: 1, meets: 0, converts: false },
  { name: "sofia marino", title: "brand lead", company: 7, replies: 2, meets: 1, converts: true },
  { name: "bram de jong", title: "cto", company: 1, replies: 1, meets: 0, converts: false },
  { name: "nina fischer", title: "finance lead", company: 6, replies: 0, meets: 0, converts: false },
  { name: "omar khalid", title: "solutions architect", company: 0, replies: 1, meets: 0, converts: false },
  { name: "grace mwangi", title: "community lead", company: 4, replies: 1, meets: 0, converts: false },
  { name: "leo carvalho", title: "founder", company: 9, replies: 2, meets: 1, converts: true },
  { name: "marta silva", title: "buyer", company: 3, replies: 0, meets: 0, converts: false },
  { name: "arun pillai", title: "engineering manager", company: 2, replies: 1, meets: 0, converts: false },
  { name: "elena rossi", title: "design lead", company: 5, replies: 0, meets: 0, converts: false },
];

// deterministic pseudo-random so a reseed looks the same
let seed = 20241018;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(list: T[]): T {
  return list[Math.floor(rand() * list.length)];
}
function chance(p: number): boolean {
  return rand() < p;
}

const OUTREACH_TEMPLATES = [
  {
    subject: "quick question about {company}",
    body: "hi {first},\n\ni've been following what {company} is building. we help teams like yours keep one record of every lead instead of five disconnected lists.\n\nworth 20 minutes next week?\n\n{rhea}",
  },
  {
    subject: "saw your post about {company}'s growth",
    body: "hi {first},\n\nliked what you shared. we do exactly this for sales teams — one inbox for leads, outreach and follow-ups.\n\nhappy to send a short walkthrough if useful.\n\nbest,\n{rhea}",
  },
  {
    subject: "{first} — thought this was relevant",
    body: "hi {first},\n\nshort note. teams your size usually lose deals in the gap between a reply and the next follow-up. that gap is what we close.\n\ncan i send you the two-minute version?\n\n{rhea}",
  },
];

const REPLY_TEMPLATES = [
  "interesting — yes, send it over. we lose track of follow-ups all the time.",
  "sure, happy to chat. thursday afternoon works.",
  "we've looked at this before but never got past a demo. what makes it different?",
  "not right now, but circle back after our series closes.",
  "this is exactly the problem we have. sending you to our head of ops.",
  "can you send details? need to loop in two other people.",
];

async function main() {
  const database = openDb();

  const existing = database.prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number };
  if (existing.n > 0) {
    console.log("workspace already exists. run `npm run db:reset` first if you want a fresh one.");
    return;
  }

  const workspaceId = newWorkspaceId();
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO workspaces (id, name, slug, domain, timezone, settings_json, created_at, updated_at)
       VALUES (?,?,?,?, 'utc', '{}', ?, ?)`,
    )
    .run(workspaceId, "leadflow", "leadflow", "leadflow.test", now, now);

  const members = TEAM.map((m) => {
    const id = newMemberId();
    database
      .prepare(
        `INSERT INTO members (id, workspace_id, name, email, role, title, avatar_hue, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, workspaceId, m.name, m.email, m.role, m.title, m.hue, now, now);
    return { id, ...m };
  });
  const [owner, tom, nadia, jonas] = members;

  // ---------------------------------------------------------------- sources
  const sourceIds = {
    website: createSource(workspaceId, { name: "website signup", kind: "form", notes: "the demo form at /pricing", sync_cadence_hours: 6 }, database),
    linkedin: createSource(workspaceId, { name: "linkedin outreach", kind: "integration", notes: "sales navigator list", sync_cadence_hours: 12 }, database),
    inbound: createSource(workspaceId, { name: "inbound demo request", kind: "form", notes: "booked through the site", sync_cadence_hours: 6 }, database),
    import: createSource(workspaceId, { name: "conference list", kind: "import", notes: "saascon 2024 attendee list", sync_cadence_hours: 48 }, database),
    referral: createSource(workspaceId, { name: "customer referrals", kind: "referral", sync_cadence_hours: 72 }, database),
    google: createSource(workspaceId, { name: "google ads", kind: "paid", notes: "non-brand search only", sync_cadence_hours: 6 }, database),
    partner: createSource(workspaceId, { name: "agency partner", kind: "partner", sync_cadence_hours: 24 }, database),
  };

  database.prepare(`UPDATE lead_sources SET last_sync_at = ? WHERE id = ?`).run(addMs(now, -3 * 3600_000), sourceIds.website);
  database.prepare(`UPDATE lead_sources SET status = 'needs_attention' WHERE id = ?`).run(sourceIds.google);

  // ---------------------------------------------------------------- companies
  const companyIds = COMPANIES.map((c) => {
    const id = newCompanyId();
    database
      .prepare(
        `INSERT INTO companies (id, workspace_id, name, domain, domain_normalized, website, industry, size, location, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, workspaceId, c.name, c.domain, c.domain, `https://${c.domain}`, c.industry, c.size, c.location, now, now);
    return id;
  });

  // ---------------------------------------------------------------- sequences and campaigns
  const sequenceIds = [
    createSequence(
      workspaceId,
      {
        name: "the short introduction",
        goal: "turn cold prospects into replies",
        description: "three touches over two weeks, then stop",
        steps: [
          { name: "first note", channel: "email", subject: "quick question about {company}", content: "hi {first}, one short question about how {company} tracks follow-ups.", waitDays: 0 },
          { name: "the useful bit", channel: "email", subject: "what we found", content: "we looked at how teams your size handle this. here is what stood out.", waitDays: 4 },
          { name: "last touch", channel: "email", subject: "closing the loop", content: "last note from me — if this isn't useful right now i won't write again.", waitDays: 7 },
        ],
      },
      database,
    ),
    createSequence(
      workspaceId,
      {
        name: "developers who care about tools",
        goal: "start a conversation with technical buyers",
        description: "slower, longer arc aimed at engineers",
        steps: [
          { name: "open", channel: "linkedin", subject: "saw your work at {company}", content: "liked what you're building. i write about lead systems — happy to swap notes.", waitDays: 0 },
          { name: "resource", channel: "email", subject: "the teardown", content: "put together a short teardown of how {company} handles inbound.", waitDays: 5 },
          { name: "check in", channel: "linkedin", subject: "worth a chat?", content: "no pressure — but if the teardown was useful i can walk you through what we do.", waitDays: 9 },
          { name: "final", channel: "email", subject: "last one from me", content: "closing this out. the door is open whenever you're ready.", waitDays: 12 },
        ],
      },
      database,
    ),
    createSequence(
      workspaceId,
      {
        name: "keep warm for a season",
        goal: "stay useful while they decide",
        description: "low pressure monthly notes",
        steps: [
          { name: "monthly note", channel: "email", subject: "something worth knowing", content: "no pitch — just something useful for teams running outbound.", waitDays: 0 },
          { name: "second month", channel: "email", subject: "another one", content: "second of these. still happy to help if timing is wrong.", waitDays: 30 },
        ],
      },
      database,
    ),
  ];

  const campaignIds = {
    founders: createCampaign(
      workspaceId,
      { name: "founder outreach — october", channel: "email", status: "active", owner_id: owner.id, description: "first wave at heads of growth and founders at 11-50 person companies", template: { subject: "quick question about {company}" } },
      database,
    ),
    signals: createCampaign(
      workspaceId,
      { name: "hiring signal triggers", channel: "linkedin", status: "active", owner_id: tom.id, description: "reaches people who just posted about building a sales team", template: {} },
      database,
    ),
    winback: createCampaign(workspaceId, { name: "quiet leads — gentle nudge", channel: "email", status: "active", owner_id: nadia.id, description: "for people who went quiet after the first wave", template: {} }, database),
    q4: createCampaign(workspaceId, { name: "q4 pipeline push", channel: "email", status: "draft", owner_id: jonas.id, description: "not started yet", template: {} }, database),
  };
  database.prepare(`UPDATE campaigns SET started_at = ? WHERE id = ?`).run(daysAgoIso(38), campaignIds.founders);
  database.prepare(`UPDATE campaigns SET started_at = ? WHERE id = ?`).run(daysAgoIso(31), campaignIds.signals);
  database.prepare(`UPDATE campaigns SET started_at = ? WHERE id = ?`).run(daysAgoIso(20), campaignIds.winback);

  createForm(workspaceId, { name: "book a demo", source_id: sourceIds.inbound }, database);
  createForm(workspaceId, { name: "get the lead report", source_id: sourceIds.website }, database);
  createForm(workspaceId, { name: "early access waitlist", source_id: sourceIds.website }, database);

  // ---------------------------------------------------------------- leads
  const leadIds: string[] = [];
  const sourceList = Object.values(sourceIds);
  const SOURCE_LABELS: Record<string, string> = {
    [sourceIds.website]: "the website",
    [sourceIds.linkedin]: "linkedin outreach",
    [sourceIds.inbound]: "a demo request",
    [sourceIds.import]: "the conference list",
    [sourceIds.referral]: "a customer referral",
    [sourceIds.google]: "google ads",
    [sourceIds.partner]: "our agency partner",
  };
  const campaignList = Object.values(campaignIds);

  for (let i = 0; i < PEOPLE.length; i++) {
    const person = PEOPLE[i];
    const company = COMPANIES[person.company];
    const companyId = companyIds[person.company];
    const ageDays = 1 + Math.floor(rand() * 75);
    const createdAt = daysAgoIso(ageDays);
    const first = person.name.split(" ")[0];
    const source = sourceList[i % sourceList.length];
    const sourceName = SOURCE_LABELS[source] ?? "the workspace";
    const owner = members[i % members.length];

    const handle = `${first.toLowerCase()}.${person.name.split(" ").slice(1).join("").toLowerCase()}`;
    const email = chance(0.15) && i % 5 === 0 ? `${first.toLowerCase()}@gmail.com` : `${handle}@${company.domain}`;

    const result = createLead(
      workspaceId,
      {
        full_name: person.name,
        email,
        phone: chance(0.5) ? `+1 415 555 ${String(1000 + i).slice(0, 4)}` : null,
        job_title: person.title,
        company_name: company.name,
        company_website: `https://${company.domain}`,
        linkedin_url: person.linkedin ?? null,
        x_url: person.x ?? null,
        location: company.location,
        industry: company.industry,
        company_size: company.size,
        source_id: source,
        owner_id: owner.id,
        score: Math.floor(rand() * 60) + 10,
      },
      { database, origin: sourceName, skipDedupe: true },
    );

    // rewind creation so history spreads out over time instead of landing today
    database
      .prepare(`UPDATE leads SET created_at = ?, updated_at = ? WHERE id = ?`)
      .run(createdAt, createdAt, result.leadId);
    database.prepare(`UPDATE lead_attributions SET first_seen_at = ?, last_seen_at = ? WHERE lead_id = ?`).run(createdAt, createdAt, result.leadId);
    database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE lead_id = ?`).run(createdAt, result.leadId);

    const leadId = result.leadId;
    leadIds.push(leadId);

    if (i % 4 === 0) {
      linkAttribution(database, workspaceId, leadId, sourceList[(i + 3) % sourceList.length], null, createdAt);
    }

    // ---- outreach history
    const touches = person.replies > 0 ? 1 + Math.floor(rand() * 2) : chance(0.45) ? 1 : 0;
    let lastSentAt: string | null = null;

    for (let t = 0; t < touches; t++) {
      const template = pick(OUTREACH_TEMPLATES);
      const sentAt = addMs(createdAt, (t + 1) * (3 + Math.floor(rand() * 6)) * 86_400_000);
      if (new Date(sentAt).getTime() > Date.now()) continue;
      const channel = i % 5 === 1 ? "linkedin" : "email";
      const campaign = channel === "linkedin" ? campaignIds.signals : campaignList[i % 3 === 0 ? 2 : 0];

      const messageId = logOutboundMessage(
        database,
        {
          workspaceId,
          leadId,
          channel,
          subject: template.subject.replace("{company}", company.name),
          content: template.body.replaceAll("{first}", first).replaceAll("{company}", company.name).replaceAll("{rhea}", owner.name),
          campaign_id: campaign,
          owner_id: owner.id,
          sentAt,
          deliveryState: "delivered",
        },
        owner.id,
      );
      database.prepare(`UPDATE messages SET opened_at = ?, delivered_at = ? WHERE id = ?`).run(addMs(sentAt, 3600_000), sentAt, messageId);
      database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE payload_json LIKE ?`).run(sentAt, `%${messageId}%`);
      lastSentAt = sentAt;
    }

    // ---- replies
    let lastInbound: string | null = null;
    for (let r = 0; r < person.replies; r++) {
      const base = lastSentAt ?? addMs(createdAt, 2 * 86_400_000);
      const receivedAt = addMs(base, (2 + Math.floor(rand() * 5)) * 3_600_000);
      if (new Date(receivedAt).getTime() > Date.now()) continue;
      const messageId = logInboundMessage(
        database,
        {
          workspaceId,
          leadId,
          channel: i % 5 === 1 ? "linkedin" : "email",
          content: pick(REPLY_TEMPLATES),
          receivedAt,
        },
        null,
      );
      database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE payload_json LIKE ?`).run(receivedAt, `%${messageId}%`);
      lastInbound = receivedAt;
    }

    // ---- some people call instead of writing
    if (chance(0.22)) {
      const calledAt = addMs(lastSentAt ?? createdAt, 2 * 86_400_000);
      if (new Date(calledAt).getTime() < Date.now()) {
        const messageId = logOutboundMessage(
          database,
          {
            workspaceId,
            leadId,
            channel: "phone",
            content: chance(0.5) ? "left a voicemail, called back once" : "talked for 12 minutes about their current process",
            sentAt: calledAt,
            deliveryState: chance(0.5) ? "connected" : "missed",
            durationSeconds: 60 + Math.floor(rand() * 900),
          },
          owner.id,
        );
        database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE payload_json LIKE ?`).run(calledAt, `%${messageId}%`);
      }
    }

    // ---- meetings
    let scheduledMeeting: string | null = null;
    for (let m = 0; m < person.meets; m++) {
      const base = lastInbound ?? lastSentAt ?? createdAt;
      const offset = (3 + m * 7) * 86_400_000;
      const when = i % 4 === 0 ? addMs(now, (2 + m * 4) * 86_400_000) : addMs(base, offset);
      const meetingId = bookMeeting(
        database,
        {
          workspaceId,
          leadId,
          title: m === 0 ? "intro call" : "product walkthrough",
          scheduledAt: when,
          durationMinutes: 30,
          ownerId: owner.id,
          campaignId: campaignList[i % 3],
          createPrepTask: true,
        },
        owner.id,
      );
      database.prepare(`UPDATE meetings SET scheduled_at = ?, created_at = ? WHERE id = ?`).run(when, addMs(when, -4 * 86_400_000), meetingId);
      database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE payload_json LIKE ?`).run(addMs(when, -2 * 86_400_000), `%${meetingId}%`);
      scheduledMeeting = meetingId;
      if (new Date(when).getTime() < Date.now() && chance(0.6)) {
        database.prepare(`UPDATE meetings SET status = 'completed', outcome = 'good conversation, sending details' WHERE id = ?`).run(meetingId);
      }
    }

    // ---- opportunities and wins
    if (person.converts) {
      const oppId = createOpportunity(
        database,
        {
          workspaceId,
          leadId,
          name: `${company.name} — annual plan`,
          amount: 4000 + Math.floor(rand() * 12) * 500,
          stage: "negotiation",
          ownerId: owner.id,
          campaignId: campaignList[i % 3],
        },
        owner.id,
      );
      // closing it through the normal path is what moves the lead to "converted"
      const wonAt = addMs(lastInbound ?? lastSentAt ?? createdAt, 6 * 86_400_000);
      if (new Date(wonAt).getTime() <= Date.now()) {
        updateOpportunity(database, workspaceId, oppId, { stage: "won" }, owner.id);
        database
          .prepare(`UPDATE opportunities SET created_at = ?, updated_at = ?, closed_at = ? WHERE id = ?`)
          .run(addMs(wonAt, -9 * 86_400_000), wonAt, wonAt, oppId);
        database.prepare(`UPDATE leads SET converted_at = ? WHERE id = ?`).run(wonAt, leadId);
        database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE payload_json LIKE ?`).run(wonAt, `%${oppId}%`);
      } else {
        database.prepare(`UPDATE opportunities SET stage = 'won', created_at = ?, closed_at = ? WHERE id = ?`).run(wonAt, wonAt, oppId);
      }
    } else if (chance(0.22)) {
      createOpportunity(
        database,
        {
          workspaceId,
          leadId,
          name: `${company.name} — pilot`,
          amount: 2000 + Math.floor(rand() * 8) * 250,
          stage: pick(["qualifying", "proposal", "negotiation"] as const),
          ownerId: owner.id,
        },
        owner.id,
      );
    }

    // ---- follow-ups that are genuinely late
    if (!person.converts && lastSentAt && !lastInbound && chance(0.5)) {
      const due = daysAgoIso(1 + Math.floor(rand() * 6));
      const messageId = database
        .prepare(`SELECT id FROM messages WHERE lead_id = ? AND direction = 'outbound' ORDER BY sent_at DESC LIMIT 1`)
        .get(leadId) as { id: string } | undefined;
      if (messageId) setMessageFollowUp(database, messageId.id, due, { actorId: owner.id });
      createTask(
        {
          workspaceId,
          leadId,
          title: `follow up with ${first}`,
          type: "follow_up",
          priority: chance(0.4) ? "urgent" : "high",
          dueAt: due,
          ownerId: owner.id,
        },
        { actorId: owner.id, database },
      );
    }

    // ---- standing work
    if (chance(0.55)) {
      const taskId = createTask(
        {
          workspaceId,
          leadId,
          title: pick(["research their current stack", `look into ${company.name}`, "find who else is on their team", "check their hiring page"]),
          description: "a bit of context before we write again",
          type: "research",
          priority: pick(["low", "medium", "medium", "high"] as const),
          dueAt: chance(0.4) ? daysAgoIso(-1 + Math.floor(rand() * 7)) : addMs(now, 86_400_000 * (1 + Math.floor(rand() * 10))),
          ownerId: owner.id,
        },
        { actorId: owner.id, database },
      );
      if (chance(0.4) && taskId) completeTask(database, workspaceId, taskId, owner.id);
    }
  }

  // ---------------------------------------------------------------- a couple of deliberate duplicates
  // same person arriving from two different places — this is what the merge screen is for
  const dupes: Array<{ record: Parameters<typeof createLead>[1]; skipDedupe?: boolean }> = [
    {
      record: {
        full_name: "kwame asante",
        email: "kwame.asante@cobalthealth.io",
        job_title: "cto",
        company_name: "cobalt health",
        company_website: "https://cobalthealth.io",
        linkedin_url: "https://linkedin.com/in/kwameasante",
        source_id: sourceIds.google,
        notes: "came in from the ads campaign, slightly different spelling",
      },
    },
    {
      record: {
        full_name: "KWAME Asante",
        email: "kwameasante+cobalt@cobalthealth.io",
        job_title: "chief technology officer",
        company_name: "cobalt health",
        company_website: "https://cobalthealth.io",
        source_id: sourceIds.partner,
        notes: "agency partner sent the same person across",
      },
    },
    {
      record: {
        full_name: "omar haddad",
        phone: "+1 415 555 0113",
        job_title: "ceo",
        company_name: "atlas robotics",
        source_id: sourceIds.partner,
        notes: "no email on this one, matched on the phone number",
      },
    },
    {
      record: {
        full_name: "sanne de vries",
        email: "sanne.devries@heliosfreight.com",
        job_title: "ops director",
        company_name: "helios freight",
        source_id: sourceIds.referral,
        notes: "a customer referred her across",
      },
    },
  ];

  const existingEmails = database.prepare(`SELECT email_normalized FROM leads WHERE workspace_id = ?`).all(workspaceId) as { email_normalized: string }[];
  const existingPhones = database.prepare(`SELECT phone_normalized FROM leads WHERE workspace_id = ? AND phone_normalized IS NOT NULL`).all(workspaceId) as { phone_normalized: string }[];

  for (const dupe of dupes) {
    const rec = dupe.record;
    const clash = rec.email
      ? existingEmails.some((e) => e.email_normalized === rec.email)
      : existingPhones.some((p) => p.phone_normalized === rec.phone);
    if (!clash) continue;

    const created = daysAgoIso(2 + Math.floor(rand() * 9));
    const result = createLead(workspaceId, rec, { database, origin: "a second source" });
    database.prepare(`UPDATE leads SET created_at = ?, updated_at = ? WHERE id = ?`).run(created, created, result.leadId);
    if (result.mergedInto) {
      database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE lead_id = ? AND type = 'lead_merged'`).run(created, result.mergedInto);
    }
  }

  // a couple of possible duplicates we are NOT sure about — these land in the review queue
  const maybeDupe: Parameters<typeof createLead>[1][] = [
    {
      full_name: "sanne de vries",
      email: "s.vries@heliosfreight.com",
      job_title: "head of operations",
      company_name: "helios freight",
      company_website: "https://heliosfreight.com",
      source_id: sourceIds.website,
      notes: "same name and company, different inbox — could be a colleague, could be the same person",
    },
    {
      full_name: "priya raman",
      email: "priya.r@cobalthealth.io",
      job_title: "founder",
      company_name: "cobalt health",
      company_website: "https://cobalthealth.io",
      source_id: sourceIds.google,
      notes: "her last job was at cobalt but she may have left",
    },
  ];

  for (const record of maybeDupe) {
    const created = daysAgoIso(1 + Math.floor(rand() * 6));
    const result = createLead(workspaceId, record, { database, origin: "a website signup" });
    database.prepare(`UPDATE leads SET created_at = ?, updated_at = ? WHERE id = ?`).run(created, created, result.leadId);
    if (result.reviewCount) {
      console.log(`  review queued: ${record.full_name} (${result.reviewCount} possible match)`);
    }
  }

  // ---------------------------------------------------------------- manual states and notes
  const allLeads = database.prepare(`SELECT id, full_name FROM leads WHERE workspace_id = ? AND merged_into_lead_id IS NULL`).all(workspaceId) as { id: string; full_name: string }[];
  for (const lead of allLeads) {
    // some people were written off by a human, which automation must not undo
    if (chance(0.08)) setStage(database, workspaceId, lead.id, "disqualified", owner.id);
    else if (chance(0.06)) setStage(database, workspaceId, lead.id, "lost", owner.id);
    if (chance(0.1)) setOutreachState(database, workspaceId, lead.id, "closed", owner.id);
    if (chance(0.35)) {
      const notes = pick([
        "prefers email, hates phone calls.",
        "budget approved for next quarter.",
        "currently using spreadsheets and a shared inbox.",
        "asked us to come back after their board meeting.",
        "went quiet after the demo — check in in a month.",
        "introduced by a customer, worth being warm with.",
        "very responsive on linkedin, slow on email.",
      ]);
      database
        .prepare(`UPDATE leads SET notes = COALESCE(notes || char(10) || char(10), '') || ? WHERE id = ?`)
        .run(notes, lead.id);
      recordEvent(database, {
        workspaceId,
        leadId: lead.id,
        actorId: pick(members).id,
        type: "note_added",
        title: "note added",
        summary: notes,
        occurredAt: daysAgoIso(1 + Math.floor(rand() * 30)),
      });
    }
  }

  // ---------------------------------------------------------------- nurture
  const nurturing = allLeads.slice(0, 16);
  for (let i = 0; i < nurturing.length; i++) {
    const lead = nurturing[i];
    const sequenceId = sequenceIds[i % sequenceIds.length];
    const enrollmentId = enrollLead(database, workspaceId, lead.id, sequenceId, { actorId: owner.id, startDelayDays: i % 4 });
    if (!enrollmentId) continue;

    // spread the steps through the past so the timeline reads naturally
    database
      .prepare(`UPDATE nurture_enrollments SET enrolled_at = ?, created_at = ? WHERE id = ?`)
      .run(daysAgoIso(20 + i), daysAgoIso(20 + i), enrollmentId);
    database.prepare(`UPDATE activity_events SET occurred_at = ? WHERE lead_id = ? AND type = 'nurture_enrolled'`).run(daysAgoIso(20 + i), lead.id);
    database.prepare(`UPDATE nurture_steps SET scheduled_at = ? WHERE enrollment_id = ?`).run(addMs(daysAgoIso(20 + i), -3 * 86_400_000), enrollmentId);

    // a few people have already finished
    if (i % 5 === 0) {
      database
        .prepare(`UPDATE nurture_enrollments SET state = 'completed', current_step = total_steps, completed_at = ?, next_step_at = NULL WHERE id = ?`)
        .run(daysAgoIso(3 + i), enrollmentId);
      database.prepare(`UPDATE nurture_steps SET status = 'sent', sent_at = ? WHERE enrollment_id = ?`).run(daysAgoIso(6 + i), enrollmentId);
    } else if (i % 5 === 2) {
      database.prepare(`UPDATE nurture_enrollments SET state = 'paused', next_step_at = NULL WHERE id = ?`).run(enrollmentId);
    }
  }

  // ---------------------------------------------------------------- automation rules
  const rules = [
    {
      name: "pull in leads who have gone quiet",
      trigger: "lead.outreach.quiet",
      description: "if nothing has happened for 14 days, put them back in a sequence",
      conditions: { daysQuiet: 14, outreachState: "awaiting_reply" },
      actions: [{ kind: "enroll", sequence: "the short introduction" }],
    },
    {
      name: "task for every new demo request",
      trigger: "lead.created",
      description: "someone filled in the demo form — someone should call them today",
      conditions: { source: "inbound demo request" },
      actions: [
        { kind: "create_task", title: "call the new demo request", type: "call", priority: "urgent", dueInHours: 4 },
      ],
    },
    {
      name: "task to follow up after every meeting",
      trigger: "meeting.completed",
      description: "book a follow-up the next working day",
      conditions: {},
      actions: [{ kind: "create_task", title: "send the notes and book the next step", type: "email", priority: "high", dueInHours: 24 }],
    },
    {
      name: "nothing but never contacted",
      trigger: "daily.sweep",
      description: "nudge the team when someone has sat untouched for a week",
      conditions: { untouchedDays: 7 },
      actions: [{ kind: "create_task", title: "the lead inbox is piling up", type: "research", priority: "medium", dueInHours: 8 }],
    },
  ];
  for (const rule of rules) {
    database
      .prepare(
        `INSERT INTO automation_rules (id, workspace_id, name, description, trigger_type, is_enabled, conditions_json, actions_json, created_at, updated_at)
         VALUES (?,?,?,?,?, 1, ?,?,?,?)`,
      )
      .run(`rule_${rule.name.replace(/\s+/g, "_")}`, workspaceId, rule.name, rule.description, rule.trigger, JSON.stringify(rule.conditions), JSON.stringify(rule.actions), now, now);
  }

  // ---------------------------------------------------------------- job history
  // a couple of real completed jobs so the settings page is not empty
  for (let i = 0; i < 6; i++) {
    enqueue(
      {
        workspaceId,
        kind: pick(["follow_up_sweep", "reply_watchdog", "nurture_dispatch", "duplicate_scan", "state_refresh"]),
        payload: { workspaceId, day: daysAgoIso(i).slice(0, 10) },
        idempotencyKey: `seed:history:${i}`,
      },
      database,
    );
  }
  database
    .prepare(`UPDATE jobs SET status = 'succeeded', attempts = 1, result_json = '{}', run_at = ?, updated_at = ? WHERE idempotency_key LIKE 'seed:history:%'`)
    .run(daysAgoIso(3), daysAgoIso(3), );
  database.prepare(`UPDATE jobs SET last_error = ?, status = 'failed' WHERE idempotency_key = 'seed:history:0'`).run("provider returned 503, will retry");
  database.prepare(`UPDATE jobs SET status = 'succeeded' WHERE idempotency_key = 'seed:history:0'`).run();

  ensureRecurringJobs(workspaceId, database);

  // ---------------------------------------------------------------- recompute everything from the log
  const ids = database.prepare(`SELECT id FROM leads WHERE workspace_id = ?`).all(workspaceId) as { id: string }[];
  for (const row of ids) recomputeLeadStates(database, row.id);
  // the merges changed counters, so give everyone one more pass
  for (const row of ids) recomputeLeadStates(database, row.id);

  const counts = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leads WHERE workspace_id = ?) AS leads,
         (SELECT COUNT(*) FROM leads WHERE workspace_id = ? AND merged_into_lead_id IS NOT NULL) AS merged,
         (SELECT COUNT(*) FROM messages WHERE workspace_id = ?) AS messages,
         (SELECT COUNT(*) FROM activity_events WHERE workspace_id = ?) AS events,
         (SELECT COUNT(*) FROM tasks WHERE workspace_id = ?) AS tasks,
         (SELECT COUNT(*) FROM dupe_candidates WHERE workspace_id = ?) AS dupes,
         (SELECT COUNT(*) FROM jobs WHERE workspace_id = ?) AS jobs`,
    )
    .get(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId) as Record<string, number>;

  console.log("seeded workspace:");
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(10)} ${value}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
