# leadflow

one workspace for every lead, conversation, task and conversion.

this is a working product, not a plan. it runs, it has real records in it, and every
number on the dashboard is a count over those records.

```bash
npm install
npm run db:seed     # builds a workspace with real history in it
npm run dev         # http://localhost:3000
```

---

## what it does

leadflow answers the questions a founder or a small sales team actually asks, from one
place, and every answer links through to the leads behind it:

| question | where it lives |
|---|---|
| how many leads do we have? | overview → ask the workspace |
| how many are new and not converted? | overview, pipeline |
| which leads haven't replied to us? | follow-ups → no reply |
| which leads haven't been nurtured? | nurture → not enrolled |
| what's overdue? | tasks → overdue |
| what should we do next? | overview → today's priorities, analytics → what to do next |

---

## the three states

the relationship is tracked as three separate things rather than one status field,
because they genuinely move independently — a lead can be nurturing and already
replied to at the same time.

- **pipeline stage** — new, to qualify, qualified, contacted, engaged, meeting booked,
  opportunity, converted, lost, disqualified
- **outreach state** — never contacted, outreach sent, awaiting reply, replied,
  follow-up due, follow-up scheduled, conversation active, closed
- **nurture state** — not enrolled, nurturing, nurture paused, ready for re-engagement,
  nurture completed

these are derived from the lead's own activity history (`src/lib/engine/states.ts`),
not set by whatever screen you happen to be on. the rules that matter:

- **sending is never a reply.** only an inbound message moves a lead to `replied`.
- the pipeline only moves forward on its own. going backwards is a human decision.
- if a person sets a state by hand it stays put, and only that axis. there is always a
  "let automation handle this again" button.

---

## everything hangs off the lead

there is one lead record and everything else points at it: messages, tasks, meetings,
opportunities, nurture enrolments, sources, notes and a single append-only
`activity_events` timeline. the dashboard, the lead states and the timeline all read
from that log, so if something did not get written to it, it did not happen.

---

## duplicate handling

people arrive from more than one place. `src/lib/engine/dedupe.ts` matches on
normalised email, linkedin profile, phone, x handle and name-plus-company, and scores
each candidate:

- **0.9 and above** — merged straight away
- **0.45 to 0.9** — queued for review at settings → duplicates, where a human decides
- below that — ignored

normalisation is deliberately boring, because that is what makes it work: `kit+work@`
and `kit@` are one person, `mail.acme.co.uk` is the company `acme.co.uk`, linkedin urls
reduce to `/in/jane-doe`, and phone numbers lose their country code.

merging keeps everything. every message, task, meeting, event, source and note moves to
the surviving record; attributions add up rather than overwrite; the old row is kept
and pointed at the survivor; and the whole operation is written to `lead_merges`.

---

## background work

reminders, nurture dispatch, source syncs, imports and the daily digest are rows in a
`jobs` table, drained by a worker inside the server process. nothing depends on a
browser being open.

- every job has an **idempotency key**, so a repeat never creates duplicate work
- failures **retry with backoff** and are then marked failed rather than retried forever
- stalled jobs whose worker died are requeued on the next sweep
- every attempt is recorded in `job_runs`

see the queue live at **settings → jobs**, or run it by hand:

```bash
npm run jobs:run
```

---

## the sections

overview · lead inbox · all leads · pipeline · outreach · follow-ups · nurture ·
lead sources · lead generation · tasks · analytics · settings

plus a standalone public capture form at `/f/[slug]` that drops submissions straight
into the workspace.

a site you do not control can post to it without the next.js runtime — urlencoded,
multipart and json all work:

```bash
curl -X POST http://localhost:3000/api/submit/book-a-demo \
     -d 'full_name=jane doe' -d 'email=jane@acme.com' -d 'company_name=acme'
```

submissions go through the same duplicate check as anything else, so the same person
filling in the form twice is still one lead.

---

## lead generation — real prospect discovery

lead generation searches a real contact database. it does not make people up, which is
why it needs an api key before it can do anything.

### providers

| provider | what it does | cost |
|---|---|---|
| **apollo** | people *and* company search, with title, seniority, location, industry and employee-count filters | free tier (needs a work email, approved by hand); search is free, revealing an address costs 1 credit per person |
| **people data labs** | people search with the sharpest filters available | free: 100 records/month, instant, but contact data is masked. paid from ~$98/month |

connect one on the **lead generation** page, or set it in the environment:

```bash
export LEADFLOW_APOLLO_API_KEY=...        # never touches the database
export LEADFLOW_PDL_API_KEY=...
export LEADFLOW_ENCRYPTION_KEY=...       # optional; one is generated into data/ if absent
```

keys saved through the interface are encrypted with aes-256-gcm before they are stored.
the plaintext is never returned by any action, never logged, and never rendered — you
only ever see the last four characters. a key is verified against the provider *before*
it is saved, so a typo is caught immediately.

### how search and email work

this is the part that trips most implementations up, so it is worth being explicit:

- **apollo's people search returns no email addresses.** it tells you only whether an
  address exists. the real address comes from a separate enrich call
  (`/people/match`), which costs 1 credit per person. we therefore search for free and
  only spend credits on the people you actually tick.
- **people data labs masks contact data on its free plan.** we record which plan a key is
  on and say so, rather than passing a masked address off as deliverable.

### the flow

1. describe the icp — title, seniority, industry, company size, location, domains
2. we translate that into the provider's own filter vocabulary and search
3. every result is run through **the duplicate engine your leads already use**, and
   staged for review — nothing is written to the leads table
4. you tick who you want. certain duplicates are never importable; probable ones start
   unticked and can be overridden
5. optionally "look up n addresses" to spend credits only on your selection
6. import. each one goes through the same `createLead` path as every other entry point,
   so it gets the source you chose, a `lead_created` entry in its timeline, and counts
   in the inbox and every dashboard number.

if there is no key, the page shows signup links, the api docs and what each plan
includes — it never shows a sample list.

### errors

provider failures are mapped to something you can act on rather than a status code:
missing credentials, bad key, plan blocked, out of credits, rate limited, bad filter,
provider outage, network, timeout. `401` and `429` are handled the way each api expects,
and a failed search writes nothing at all.

---

## layout

```
src/
  app/            routes, server actions, the root layout
  components/     the design system and the interactive pieces
  lib/
    db/           schema, migrations, ids, time helpers
    engine/       normalisation, activity log, state derivation, dedupe, merge
    queries/      one module per area — leads, outreach, tasks, deals, nurture,
                  sources, analytics
    prospecting/  provider adapters (apollo, people data labs), encrypted key
                  storage, and the search → review → import orchestration
    jobs/         the queue, the handlers, the scheduler
scripts/          seed, migrate, reset, run-jobs
tests/            the rules above, checked
```

---

## commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # production server
npm test             # 84 checks across four suites
npm run typecheck    # tsc, no errors
npm run db:seed      # a workspace with real history
npm run db:reset     # start over
npm run jobs:run     # drain the queue now
```

---

## notes

- data lives in sqlite at `data/leadflow.db` via `better-sqlite3`. migrations run
  automatically on first connection.
- the seeded workspace is deliberately messy: duplicates that really collide, overdue
  work, replies nobody answered, and leads that have been left alone too long.
- lead generation talks to the real apollo and people data labs apis. with no key
  configured it shows setup instructions and searches nothing.
- all interface text is lowercase on purpose.