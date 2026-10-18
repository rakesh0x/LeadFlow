Prompt 1:- you’re a senior full stack engineer, product designer and system architect, working on your own. your job is to build a working lead management and lead generation system, not just plan one.

please don’t stop at research, a plan, mockups or a static dashboard. i want a polished, modern saas product that a startup founder or a small sales team could open every day to find leads, run outreach, nurture prospects and turn them into revenue.

what this product is for

it’s one workspace that pulls leads in from every source and can answer these questions instantly:
- how many leads do we have?
- how many are new?
- how many are old?
- how many have converted?
- which leads are new and not converted yet?
- which leads haven’t replied to us?
- which leads haven’t been nurtured?
- what should we do next to get more leads and move the current ones forward?

it should be the source of truth for every lead, conversation, task, follow-up, campaign and conversion. please don’t build a generic crm made of disconnected pages. every feature should hang off the lead records and their activity history.

layout and navigation

use a clean app shell with a collapsible sidebar and these sections:
- overview: the main dashboard and today’s priorities
- lead inbox: new leads waiting to be processed
- all leads: a searchable, filterable database
- pipeline: a kanban board showing how leads progress
- outreach: campaigns, messages sent and conversation history
- follow-ups: replies waiting on us and outreach that went quiet
- nurture: prospects we’re developing over time
- lead sources: connected platforms, imports, forms and attribution
- lead generation: tools for finding and importing new prospects
- tasks: calls, emails, research, follow-ups and anything else to do
- analytics: conversion rates by channel, campaign and period
- settings: workspace, team, integrations, custom fields and automation rules

the most important actions should never be more than one or two clicks away.

lead profiles

every lead gets its own profile with:
- full name, email, phone
- company name and website, job title
- linkedin url, x url or any other social profile
- location, industry, company size
- notes and useful context

relationship status

please track these three things separately instead of squeezing them into one status field.

pipeline stage: new, to qualify, qualified, contacted, engaged, meeting booked, opportunity, converted, lost, disqualified

outreach state: never contacted, outreach sent, awaiting reply, replied, follow-up due, follow-up scheduled, conversation active, closed

nurture state: not enrolled, nurturing, nurture paused, ready for re-engagement, nurture completed

these should update on their own from recorded activity wherever possible, and people should be able to correct them by hand. a lead can be nurtured and already contacted at the same time. sending a message must never count as a reply.

duplicate detection

match leads using normalised email, profile urls and any other identifiers available. when the same person arrives from more than one source, merge or link the records without losing the source or any interaction history. when a match is unclear, show a review screen instead of merging two people who might be different.

overview dashboard

make it a dashboard people actually work from, not a decorative one. show:
- total leads and leads acquired in the chosen period
- new, unprocessed leads
- qualified leads
- leads contacted
- leads that replied
- leads awaiting a reply
- overdue follow-ups
- leads being nurtured
- meetings booked
- opportunities created
- leads converted
- conversion rate by stage

every number must come from real records and activity events.

outreach

give people one place to manage and track everything they send out. support email, linkedin, x, website contact forms, phone calls and any other channel the user sets up. for each message record the channel, recipient, message content where available, sent time, delivery state, reply time and next follow-up date.

tasks and follow-ups

build a proper task layer connected to leads and campaigns. each task has a title, description, linked lead, due date and time, priority, owner, type, status and completion time. include views for today, overdue, upcoming and completed.

people should be able to create a task straight from a lead profile, tick it off in place, and jump to the next pending one. completing a task should add an event to the lead’s timeline and refresh the lead’s states where it makes sense.

for reminders and scheduled work, use real background jobs with retries and idempotency. please don’t depend on browser timers for anything that should run on the server.

how i want it to feel

all interface text in lowercase, written in simple, friendly, human language. no jargon, no filler.

Prompt 2:- 

Leadflow is already built and passing its existing tests. Do not rebuild it or rewrite working features.

Focus on replacing the mock lead generation tool with **real prospect discovery**.

1. Research official APIs and choose a practical, affordable provider for finding real companies and decision-makers based on ICP, industry, location, company size, and job title.
2. Integrate the provider into the existing Lead Generation page, with secure API key configuration, real search results, pagination, error handling, and clear connection status.
3. Let users review prospects, detect duplicates, and selectively import them into the existing lead database with correct source attribution.
4. Never fabricate leads or contact details. If credentials are missing, show setup instructions instead of fake results.
5. Reuse the existing database, lifecycle engine, activity timeline, and analytics. Avoid breaking working functionality.
6. Test the real discovery-to-import workflow, run existing tests, type checks, and production build, and fix regressions.

Inspect the current implementation first, then build and verify the changes. Do not stop at a plan. Clearly report what works live and what still requires API credentials.

Prompt 3:- 

Leadflow's lead discovery is built. Now implement a real Gmail integration without rebuilding existing features.

- Connect Gmail using official Google OAuth and Gmail APIs.
- Sync sent and received emails, matching conversations to leads by email address and thread ID.
- Automatically update outreach states when messages are sent and replies arrive.
- Build a unified inbox showing replies awaiting our response and leads awaiting a reply.
- Calculate follow-ups from actual message timestamps and configurable rules.
- Prevent duplicate messages during sync retries and preserve the existing activity timeline.
- Let users send emails through Leadflow with explicit approval before sending.
- Handle expired tokens, missing permissions, sync failures, and disconnected accounts properly.
- Never fabricate email activity or mark a drafted message as sent.

Inspect the existing architecture, implement the complete integration, and test the workflows. Run all existing tests, type checks, and production build. Report any features that still require live credentials.

Prompt 4:- 

Fix the TypeScript/JSX syntax error at line 220, column 19 ( ) expected in the current file.

Inspect the surrounding JSX and trace the opening and closing parentheses, braces, and tags to find the actual cause. Pay special attention to accounts.map(), the Badge component, and nearby template literals.

Fix the root cause with the smallest possible change. Run TypeScript checks and the production build to verify the fix. Do not guess, apply random changes, or rewrite unrelated code. Report the exact cause and fix.