# Aoibh Studio — Backend Architecture Proposal

Status: **Partially built, and diverged from this plan in real ways** — see
section 0 below before reading the rest of this document as current truth.
Sections 1–10 were written as an up-front design and are still the best
reference for the pieces that *aren't* built yet (tasks, formal status-event
tracking, brand QA, chat, designer/staff dashboards, auth, marketing
consent), but the schema and phase order they describe no longer match
what's actually running in production. Read section 0 first, then treat the
rest as "the plan as originally conceived," correcting for section 0 where
the two disagree.

## 0. Current actual state (as of 2026-09-04)

This project's real, deployed code lives in the GitHub repo
`marcello88c/Aoibh-UI` (Vercel project `aoibh-ui`) — cloned locally into
this same folder. It diverged significantly from the schema and phase order
below, built by a mix of hands (a friend's initial deploy, then further
work) without this document being updated to track it. This section exists
so future work starts from what's actually there, not from section 1–11's
original assumptions.

### What's actually live

- **Site mode switch** (section 8 / migration phase 1) — `middleware.js` +
  `api/site-mode.js`. All four modes implemented (live/beta/private/
  maintenance), gated by `SITE_MODE_ADMIN_SECRET` as the interim admin
  check exactly as section 8's open questions anticipated. **Currently
  broken in production** — see Known issues below.
- **Stripe payments** — `api/create-checkout.js` + `api/stripe-webhook.js`.
  Not anticipated anywhere in sections 1–11 at all. A 30%-deposit /
  70%-balance flow on the €695 Trial Project: `create-checkout.js` opens a
  Stripe Checkout session for whichever stage is due, `stripe-webhook.js`
  listens for `checkout.session.completed` and flips
  `briefs.payment_status` (`pending` → `deposit_paid` → `paid_in_full`).
  Confirmed working in Stripe test mode against real `briefs` rows.
- **Persisted dashboard** — `dashboard.html` + `api/dashboard-data.js`.
  Reads a real `briefs` row by `?id=<uuid>` (no login), cross-references
  the matched designer/art-director from a hardcoded roster (still
  duplicated across 3 files — see Known issues), and renders
  deposit/in-progress/delivered states based on `payment_status`.
- **Deliverable upload** — `upload.html` + `api/upload-deliverable.js`.
  Internal-only (not linked from the public site): uploads to Supabase
  Storage's `deliverables` bucket and writes a `deliverables` row.
- **Contact capture** — `api/contact.js`. Writes to a `contacts` table and
  emails a notification via Resend.
- **`match-designer.js`** now saves every completed match to `briefs`
  (email, name, answers, match result, a randomly-assigned art director)
  and sends a Resend lead-notification email. This is a real, working
  version of section 5's "capture the lead early" decision — just via a
  single `briefs` insert at match time rather than the proposed
  `clients` + `projects` rows created at review-screen render.

### How the actual schema differs from sections 1–2 below

Reality collapsed the proposed multi-table design into three simpler
tables, built directly rather than through the migration path below:

| Section 2's proposal | What's actually live | Gap |
|---|---|---|
| `clients` + `projects` (split) | single `briefs` table | No separate client identity — repeat clients aren't linked across briefs. `briefs` also carries the Stripe/payment columns that section 2 never designed for. |
| `contact_messages` | `contacts` | Simpler shape: just `id`, `created_at`, `query`, `email` — no `status` enum, no `project_id` link back. |
| `assets` + `qa_checks` | `deliverables` | No AI QA at all yet — `deliverables` is just a file pointer (`brief_id`, `file_name`, `file_url`), populated by *you* via `upload.html`, not by a designer, and with no review/flagging step. |
| `designers` table | still the hardcoded `ROSTER` array | Migration phase 2 (lowest-risk, per section 11) never happened — and the roster is now duplicated across `api/match-designer.js` *and* `api/dashboard-data.js`, so it has to be updated in two places if a designer changes. |
| `site_settings` | exists, matches the proposed shape | Table exists but has no `GRANT` for any API-facing role — see Known issues. |
| `tasks`, `project_team`, `status_events`, `brand_specs`, `qa_checks`, `chat_messages` | none exist | Nothing built here — `dashboard.html`'s status card literally reads `"Placeholder — no live stage tracking yet."` The 8-stage pipeline from section 4 is still just a design, even though payments (section 4 didn't even cover) are live. |

### Known issues (found 2026-09-04, not yet fixed)

1. **`site_settings` has no Postgres grant for `service_role`.** Confirmed
   via direct query — even the service-role key gets `permission denied for
   table site_settings`. Since `api/site-mode.js` fails open to `"live"` on
   any error (by design, to avoid an outage locking out the whole site),
   this means the site-mode feature silently never actually reads or
   writes real state right now — every request is quietly falling back to
   the default. Fix: `GRANT SELECT, UPDATE ON public.site_settings TO
   service_role;` in the Supabase SQL editor.
2. **Dead duplicate files at the repo root.** `create-checkout.js` and
   `stripe-webhook.js` exist both at the repo root and under `api/`. Only
   the `api/` copies are actually deployed as Vercel functions — the root
   copies are inert. The root `create-checkout.js` also still has the bug
   the latest commit (`99fad28`) fixed in the `api/` version (wrong
   success/cancel redirect URL) — harmless since it's dead code, but worth
   deleting so it doesn't get mistaken for the live version later.
3. **No auth on `dashboard-data.js` or `upload-deliverable.js`** — both
   explicitly commented as temporary/no-login. Anyone who has (or guesses)
   a `briefs` UUID can read that client's full brief and upload files
   against it. Low real-world risk while UUIDs aren't shared publicly, but
   a real gap before this is used for actual paying clients at scale.
4. **A couple of `deliverables.file_url` rows have a stray leading `\n\n`**
   in the stored URL, breaking the link. Looks like leftover data from an
   earlier version of the upload path — the current `upload-deliverable.js`
   builds the URL cleanly, so this shouldn't recur, but the 2 existing bad
   rows should be cleaned up by hand.
5. **`node_modules` was committed to git** (~1,468 files) because
   `.gitignore` only added `node_modules/` after some commits already
   tracked it. Fixed as part of adopting this repo as the working copy —
   see the commit that untracks it.

### Required environment variables (confirmed from the actual code)

`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`,
`SITE_MODE_ADMIN_SECRET`. All confirmed present in the Vercel project
already (deployment is working); not yet in a local `.env.local` for this
folder — add one before trying to run anything locally.

---

## Why this exists

*(Original framing below, kept for context — "the current site" it refers
to is now out of date; see section 0 above for what's actually running.)*

The current site (`UI/index.html` + `UI/match-designer.js` +
`UI/phrase-questions.js`) is a working front-end prototype. The brief flow,
designer matching, and the Studio dashboard all run on in-memory JavaScript
state in the visitor's browser — nothing persists past a page refresh, and
two visitors can't see each other's data. This document proposes what a real
backend would look like to change that.

---

## 1. Recommended stack

A stack chosen to stay close to what's already there rather than
introducing something unrelated:

- **Database:** Postgres (via Supabase or Neon — both give you Postgres +
  hosted auth + a generous free tier, which suits a project this size).
- **API layer:** Extend the existing serverless-function pattern
  (`match-designer.js`, `phrase-questions.js` are already this shape) —
  each endpoint becomes a small function talking to Postgres instead of
  just calling the Anthropic API and returning mock data.
- **Auth:** Supabase Auth (or Clerk, if you want a more polished off-the-shelf
  login UI). Either supports email/password and magic-link login without
  building auth from scratch.
- **Hosting:** Wherever the frontend already deploys (Vercel is a natural
  fit given the `/api/*.js` file convention already in use).

This is a recommendation, not a requirement — the schema below is portable
to any relational database, and the API shape would look similar on any
Node-based serverless platform.

---

## 2. Database schema

### `users`
The umbrella table for anyone who can log in — staff, designers, and
(optionally, later) clients.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| email | text, unique | |
| name | text | |
| role | enum: `client`, `designer`, `staff`, `admin` | |
| avatar_url | text, nullable | |
| created_at | timestamptz | |

### `clients`
One row per client contact — created automatically the first time someone
completes a brief with a given email.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK → users.id, nullable | null until/unless they get a login |
| name | text | |
| email | text, unique | |
| phone | text, nullable | only collected if the client opts into SMS updates |
| notify_email | boolean, default true | functional — project status updates. See section 4 |
| notify_sms | boolean, default false | off by default — see section 4 |
| marketing_opt_in | boolean, default false | separate legal basis from notify_email — see section 10. Off by default; never bundled with the functional signup |
| marketing_opt_in_at | timestamptz, nullable | when consent was actually given — a real timestamp, not just a boolean, in case it's ever needed to demonstrate consent was genuinely captured |
| created_at | timestamptz | |

### `designers`
Replaces the hardcoded `ROSTER` array in `match-designer.js`.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK → users.id, nullable | |
| name | text | |
| title | text | |
| experience_years | int | |
| location | text | |
| tags | text[] | used for match scoring, same role as today's `tags` array |
| avatar_url | text, nullable | |
| active | boolean | so a designer can be paused without deleting history |
| created_at | timestamptz | |

### `projects`
One row per approved brief — created when someone clicks "Approve & begin
project" (today this just opens the Studio view locally with nothing saved).

The `client_id` foreign key already means a client can have many `projects`
rows — the schema itself doesn't block a real request queue. What's
actually missing is everything *around* it: a way to submit request #2 from
inside the dashboard, and a check that enforces the plan's monthly cap
before allowing it. See section 4.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| job_number | serial or short code | what the triage "job number" flow looks up |
| client_id | uuid, FK → clients.id | |
| designer_id | uuid, FK → designers.id, nullable | null while unmatched / below 80% confidence |
| project_type | text | brief answer: "project" |
| style | text | brief answer: "style" |
| budget_raw | text | as typed, e.g. "$2,000" |
| budget_amount | numeric, nullable | parsed value, mirrors today's `parseBudgetAmount` |
| deadline_raw | text | as typed |
| match_confidence | int, nullable | 0–100, from the matching step |
| status | enum: `matching`, `in_progress`, `review`, `shipped`, `below_budget`, `human_handoff` | |
| needs_backend_dev | boolean | mirrors today's `needsBackendDev()` heuristic |
| created_at | timestamptz | |

### `tasks`
Backs the Creative Tasks kanban — currently seeded, static, and thrown away
on refresh.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → projects.id | |
| title | text | |
| status | enum: `todo`, `in_progress`, `done` | |
| assignee_user_id | uuid, FK → users.id, nullable | |
| position | int | for manual ordering within a column |
| created_at / updated_at | timestamptz | |

### `project_team`
Junction table — who's staffed on a project (Aoibh/AI PM, client, designer,
optional backend dev). Modeling this as its own table (rather than fixed
columns on `projects`) means the team can grow beyond the four current
roles without a schema change.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → projects.id | |
| user_id | uuid, FK → users.id, nullable | null for the AI PM (Aoibh isn't a real user row) |
| role_label | text | e.g. "AI Project Manager", "Client", "Designer", "Backend Developer" |
| created_at | timestamptz | |

### `status_events`
An audit trail — lets "job number 2778, what's the status?" pull something
real instead of the current canned "one sec, let me look" message. Also now
the table that drives client notifications — see section 4.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → projects.id | |
| stage | enum: `brief_received`, `matched`, `drafts_created`, `sent_to_client`, `changes_requested`, `designer_revising`, `re_checked`, `delivered` | the same 8 stages already defined in the site's journey-tracker component — reused as-is, not redesigned |
| note | text | |
| notified_via | text[], nullable | e.g. `{dashboard,email}` — which channels actually fired for this event |
| created_at | timestamptz | |

### `contact_messages`
One row per submission from the footer "Contact the studio" modal. Deliberately
separate from `clients`/`projects` — a contact message isn't a brief and
shouldn't force-create a client record; if it later turns into real work, a
`clients`/`projects` row can be created and linked back to this row.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| query | text | what they typed when asked "what can I help you with?" |
| email | text | |
| status | enum: `new`, `contacted`, `converted`, `closed` | for staff to triage |
| project_id | uuid, FK → projects.id, nullable | set if this later becomes real work |
| created_at | timestamptz | |

### `brand_specs`
One row per client — the structured, checkable version of their brand
guidelines (not a PDF). This is what the AI QA check compares uploaded
assets against. Populated once per client, ideally right after their brief
is approved.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| client_id | uuid, FK → clients.id | |
| palette | jsonb | array of approved hex codes, e.g. `["#293239", "#C6CBD2", "#0E30FC"]` |
| typography | jsonb | approved typeface name(s), e.g. `["Neue Machina"]` |
| logo_rules | jsonb, nullable | free-form notes on clearance/minimum size, if defined |
| created_at / updated_at | timestamptz | |

### `assets`
One row per file a designer uploads for a project.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → projects.id | |
| uploaded_by_user_id | uuid, FK → users.id | the designer |
| file_url | text | wherever the file itself is stored (e.g. Supabase Storage) |
| filename | text | |
| created_at | timestamptz | |

### `qa_checks`
One row per AI review of an asset — the record that backs the flagged
issues view in the Studio dashboard.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| asset_id | uuid, FK → assets.id | |
| issue_type | enum: `color_mismatch`, `typography_mismatch`, `logo_issue`, `other`, `none` | `none` = cleared |
| confidence | int | 0–100, how sure the AI is about the flag |
| detail | text | the specific finding, e.g. "background is #1A1A1A, not on the approved palette" |
| status | enum: `flagged`, `cleared_by_ai`, `approved_by_human`, `sent_back` | tracks the human decision from the flagged-issues view |
| reviewed_by_user_id | uuid, FK → users.id, nullable | who made the human call, if any |
| created_at / reviewed_at | timestamptz | |

### `chat_messages`
Dashboard chat between a client and Aoibh, scoped to a single project — see
section 6 for what this is (and isn't) meant to handle.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → projects.id | scoped per-project, not one global thread |
| sender | enum: `client`, `aoibh` | |
| body | text | |
| flagged_as_feedback | boolean, default false | set true when a message reads as feedback on the work rather than a logistics question — see section 6 |
| created_at | timestamptz | |

### `site_settings`
A single-row table controlling the site's current mode — see section 8 for
the full mechanism. Deliberately DB-backed rather than a Vercel
environment variable, so it can change instantly without a redeploy.

| Column | Type | Notes |
|---|---|---|
| id | int, PK | always `1` — this table only ever holds one row |
| mode | enum: `live`, `beta`, `private`, `maintenance` | |
| private_access_code | text, nullable | checked against a cookie/query param when `mode = private` |
| maintenance_message | text, nullable | optional override text for the maintenance page; falls back to a default if blank |
| updated_at | timestamptz | |

---

## 3. API endpoints

Proposed additions/changes to the existing `/api/*` pattern:

| Endpoint | Method | Purpose | Replaces |
|---|---|---|---|
| `/api/phrase-questions` | POST | *(unchanged)* | — |
| `/api/match-designer` | POST | Reads `designers` table instead of the hardcoded `ROSTER`; writes nothing yet | Existing file, swap mock roster for a DB query |
| `/api/create-project` | POST | Called on "Approve & begin project" — creates `clients` (if new), `projects`, seed `tasks`, and `project_team` rows | New — this is the missing piece today |
| `/api/project/new` | POST | Submits a new request from an *existing* client, from inside the dashboard. Checks the plan's monthly cap before creating the row — see section 4 | New — the actual request-queue entry point |
| `/api/project/:id/status` | PATCH | Advances a project to the next of the 8 pipeline stages; writes a `status_events` row and fires notifications on the client's opted-in channels | New — see section 4 |
| `/api/contact` | POST | Called when the footer "Contact the studio" modal completes — writes a `contact_messages` row | New — currently just `console.log`s and discards the submission |
| `/api/project/:jobNumber` | GET | Powers the "job number" lookup branch with a real status instead of a canned line | New |
| `/api/project/:id/tasks` | GET / PATCH | Load and update the kanban board; PATCH moves a task between columns and persists it | New |
| `/api/assets` | POST | Designer uploads a finished asset; kicks off the AI QA check on save | New |
| `/api/qa-check` | POST | Runs an uploaded asset's file against the client's `brand_specs` (palette, typography) via AI vision; writes the result to `qa_checks` | New — backs the flagged-issues view |
| `/api/qa-check/:id/review` | PATCH | Records your decision on a flagged item — approve, send back to designer | New |
| `/api/auth/*` | — | Handled by Supabase Auth / Clerk directly, not hand-rolled | New |
| `/api/integrations/slack` | POST | Internal — posts a formatted message to a Slack webhook when a tracked event fires (new brief, deadline approaching, file uploaded). Not client-facing. | New — see section 7 |
| `/api/project/:id/chat` | GET / POST | Dashboard chat scoped to one project — logistics questions only, not creative feedback. See section 6 for the scope boundary and why it's enforced here, not left to the client's judgment. | New |
| `/api/site-mode` | GET / POST | Internal/admin only — reads the current `site_settings` row; POST updates it (mode, private access code, maintenance message). GET is also what the middleware itself calls. See section 8. | New |

All of these follow the same "fail soft" convention already established in
`match-designer.js` and `phrase-questions.js` — if the database call fails,
degrade to the current mock behavior rather than showing the visitor a
broken page.

---

## 4. Request queue & status notifications

The two biggest gaps flagged in `Research/pre-launch-readiness-tiers.md`.
Addressed together here because notifications depend on the queue existing
first — there's nothing real to notify about otherwise.

### The request queue

**Design decision, made explicit:** each plan's monthly figure ("up to 1 /
3 / 6 projects") counts **requests submitted during the billing period**,
not how many are simultaneously active. This isn't a new decision so much
as a confirmation of one already made — this is exactly what the pricing
copy already says, and it deliberately closed the earlier "1 active project
at a time" loophole that let usage scale unboundedly against a flat fee.
Carrying that same logic through to the schema keeps it consistent rather
than accidentally reintroducing a concurrency-based interpretation at the
database layer.

**What actually needs building** (the schema doesn't block this — see the
note on `projects` above):

1. **A "New Request" entry point inside the dashboard itself**, not just
   the marketing site's "Start a brief" flow. A subscribed client shouldn't
   have to re-enter their name, email, and budget to submit request #2 —
   `/api/project/new` creates a project for an *existing* client_id
   directly from the dashboard.
2. **Cap enforcement at creation time.** Before inserting the new `projects`
   row, count how many that `client_id` already has with `created_at`
   inside the current billing period, and compare against their plan's
   limit. A computed check against existing rows, not a separate counter
   table to keep in sync — fewer moving parts, nothing that can drift out
   of sync with reality.
3. **The dashboard becomes a list, not a single view.** Right now the
   Studio dashboard shows one project. Once a client can hold two or three
   at once, the dashboard's job changes from "show the project" to "show
   my projects, let me pick one" — a real UI change, not just a backend one.

### Status notifications

**Trigger points: the 8 pipeline stages already designed**, reused exactly
as they exist in the site's journey-tracker component today — no new stage
model to invent:

Brief received → Matched to a designer → First drafts created → Samples
sent to you → Changes requested → Designer revises → Re-checked →
Delivered & paid.

`/api/project/:id/status` advances a project through these, writes a
`status_events` row, and fires whichever channels the client has opted
into.

**Channels, and how each is actually handled:**

| Channel | Default | Notes |
|---|---|---|
| **Dashboard** | Always on | Not really a "notification" to build — the dashboard already reflects live status the moment the backend is real. No extra work beyond the backend existing. |
| **Email** | On | The primary external channel. A transactional email provider (Resend, Postmark, SendGrid are the standard options) called from the same code path that updates status — not a separate system to architect. |
| **SMS / text** | Off, opt-in | Real added cost and complexity: a per-message provider cost (e.g. Twilio), a phone number to collect and verify, and messages that cost money every time they're sent — worth reserving for genuinely time-sensitive stages (e.g. "Delivered") rather than firing on all 8, which would read as spammy and cost more than it's worth. |

**Practical sequencing**: email on all 8 stages is the sensible default to
build first. SMS, if it's wanted at all, should probably launch scoped to
just 1–2 of the highest-value stages (delivery, and maybe "changes
requested" if a fast client response matters) rather than mirroring every
email trigger — worth deciding deliberately rather than defaulting to "SMS
does everything email does."

---

## 5. Brief hand-off & lead capture

Two decisions made explicit here, both about what happens between a
completed brief and an approved project. Placed right after section 4
since both shape the same part of the flow — before a project is
persisted in the "normal" sense.

### Producer hand-off ownership

**Decision: when a brief lands below 80% match confidence, the follow-up
comes from a named human producer — never from Aoibh.** The FAQ and the
vetting content already state this plainly ("one of our producers will
personally pair you with the right designer"). If Aoibh voiced that
follow-up instead, it would quietly contradict copy already live on the
site — the AI taking credit for a handoff that's specifically supposed to
prove a human stepped in.

- The schema already supports the state itself — `projects.status`
  includes `human_handoff` (see above), and `designer_id` is already
  nullable for exactly this case. Nothing new needed there.
- What's missing: no field yet records *which* producer picked it up. Add
  `assigned_producer` (nullable text for now — formalize into a proper FK
  once there's an actual staff/producers table; not urgent while the team
  is this small).
- **Real gap: the 8 pipeline stages (`status_events.stage`, section 4)
  don't include a hand-off stage.** So even once the notification system
  exists, this specific moment — arguably the one most worth getting
  right — wouldn't be trackable through it. Worth adding a `human_handoff`
  stage to that enum too, so the producer's own follow-up becomes a real
  tracked event rather than an ad-hoc one-off sitting outside the system
  built for everything else.
- Whichever channel eventually sends this (dashboard/email), attribute it
  to the named producer, not "Aoibh" — same reasoning as above, applied to
  the actual notification copy once that exists.

### Lead capture before final approval

**Decision: `clients` and `projects` rows should be created as soon as the
brief itself is complete — the moment the review screen renders — not
only when "Approve & begin project" is clicked.**

Today, nothing is saved unless that final button is clicked. A client who
closes the tab at the "no confident match" screen (or anywhere else on the
review screen) leaves zero trace, even though their name, email, and full
brief were already sitting in the chat state a moment earlier. Capturing
early means a producer can still follow up on a real lead even when the
client never clicks through.

- **Practical shape:** create the row with `status: matching` or
  `status: human_handoff` (whichever the match outcome was) at the point
  the review screen renders. "Approve & begin project" then becomes a
  status transition (e.g. to `in_progress`) on an *already-existing* row,
  not the moment of creation.
- **Why not a separate `leads` table:** the existing `projects` schema
  already has the right shape for this — a nullable `designer_id`, and a
  `status` enum that already includes pre-approval states. Reusing it
  avoids maintaining two parallel structures for what's really the same
  entity at different points in its life, and means a lead that later
  *does* approve doesn't need migrating between tables.
- Considered and rejected: forcing every match to clear 80%+ regardless of
  actual fit, as an alternative fix for the same drop-off risk. Rejected
  because the 80% threshold is referenced explicitly in the FAQ, the
  vetting article, and the vetting modal — always clearing it would make
  every match score on the site meaningless, not just this one, and risks
  producing weak first drafts that burn revision rounds against a plan
  that caps them at 2. Capturing the lead earlier solves the actual
  problem (losing the client's info) without that cost.

---

## 6. Dashboard chat — scope boundary

**Decision: yes for logistics, no (or rather, redirected) for feedback on
the actual work.** The type of question matters more than whether a chat
box exists at all.

### What Aoibh handles in the dashboard

Status, timelines, "how do I upload a file," "what does this stage mean" —
the same logistics/routing role Aoibh already plays everywhere else on the
site (the triage branch, the brief intake). Low risk, on-brand, genuinely
reduces friction.

### What gets redirected, not answered

"Can you change the logo color," "this font feels wrong," "why does this
look off" — anything that's actually feedback on the work. Two reasons
this isn't just a brand-consistency preference:

1. **It would open a second, untracked channel for exactly what the
   revision system already exists to track.** The task review panel
   (`taskFeedbackSend`, section on task feedback) counts every round
   against the plan's stated cap — 1 for Trial Project, 2 for
   subscriptions. A free-form request typed into dashboard chat doesn't
   touch that counter at all. That's not a small inconsistency; it's a
   real hole in the margin protection the cap exists for.
2. **It blurs a line the rest of the site works hard to keep clear.** The
   FAQ, the vetting article, and the pipeline all consistently separate
   "AI handles logistics" from "a human handles creative judgment."
   Answering design feedback as Aoibh — under the same trusted voice used
   for everything else — risks generic or simply wrong answers landing
   with more authority than they've earned, especially since Aoibh, as
   scoped, doesn't have the brief-specific context a real answer would need.

### How the redirect actually works

`chat_messages.flagged_as_feedback` exists for this: a message gets
flagged (simple keyword heuristic to start — "change," "revise," "don't
like," "different color," etc. — refined later if needed) and Aoibh
responds with a redirect rather than attempting an answer: *"Sounds like
feedback on the design — want to leave that on the task directly so it's
tracked against your plan?"* with a link straight to the relevant task's
review panel. The message still saves to `chat_messages` for the record,
it just doesn't get treated as something Aoibh resolves on the spot.

### Scope note

Persistent, per-project chat history doesn't exist anywhere in the current
architecture — this is a real feature addition (the `chat_messages` table
above), not a small extension of something already planned.

---

## 7. Slack integration (optional, once the backend exists)

Not a phase of its own — a small addition once `projects` and `tasks` are
real. Two independent pieces, either one can be skipped:

**One-way notifications (Aoibh → Slack).** A webhook call added to whichever
endpoint already handles the event — no new infrastructure. Natural triggers,
using what's already built:

- New brief approved (`/api/create-project`) → post the project summary
- Deadline clock (the Studio dashboard countdown) crosses a threshold, e.g.
  3 hours remaining → post a reminder to the relevant channel
- A file lands in the "Files" upload section → post a link
- A `qa_checks` row comes back `flagged` → post it to a review channel,
  same information already shown in the dashboard's flagged-issues view

**Two-way commands (Slack → Aoibh).** More setup — register a Slack app,
handle OAuth, define slash commands (e.g. `/aoibh status 2778` querying
`/api/project/:jobNumber`) — but still standard Slack-app work, not custom
engineering.

Sequencing: this needs real `projects`/`tasks` rows to notify about or query,
so it slots in naturally after migration phase 4 below, not before it.

Distinct from **Claude Tag** (Anthropic's own product for tagging @Claude
into a Slack thread) — that's a separate integration; the two could coexist
(e.g. Aoibh posts a project update, someone tags @Claude in that thread to
ask a follow-up) but one doesn't require the other.

---

## 8. Site mode switch — live / beta / private / maintenance

Ties directly into the soft-launch approach already recommended in
`pre-launch-readiness-tiers.md` — "private" mode is the actual technical
mechanism for running that pilot-client phase, not just a nice-to-have
alongside it.

### The four modes

| Mode | Behavior |
|---|---|
| **Live** | Normal — fully public, no gate |
| **Beta** | Fully public, functionally identical to Live, but the frontend shows a small "beta" indicator — useful once public but still stabilizing |
| **Private** | Password/access-code gate before anything loads. This is what makes the pilot-client soft launch possible without the site being genuinely public |
| **Maintenance** | Everything (except a health-check endpoint) redirects to a static, on-brand "back shortly" page — same visual treatment as the 404 page already built |

### How it actually works

- **Vercel Edge Middleware** — a single file that runs on every request
  before it reaches any page, and redirects/blocks/passes through based on
  the current mode.
- **Mode lives in Supabase** (`site_settings`, above) — deliberately not a
  Vercel environment variable. An env var needs a full redeploy to change,
  which is exactly wrong for maintenance mode: that switch needs to flip
  in seconds during a real incident, not wait on a deploy pipeline.
- **Short cache on the middleware's read** (30–60 seconds) so it's not
  hitting Supabase on every single request — a real incident is exactly
  when you don't want the mode-check itself to become a bottleneck.
- **Private mode's gate**: check a cookie or query param against
  `private_access_code`. Once verified, set a cookie so pilot clients
  aren't re-entering the code on every visit.

### Scope note

Genuinely light — one middleware file, one settings table, one
maintenance-page design. Needs Supabase live before the middleware has
anything to check against, so it can't be built fully standalone against
the current static site — but it's small enough to fold into an early
migration phase rather than needing its own.

---

## 9. Designer and staff dashboards

**Needed — and not a small addition.** Every dashboard decision made so
far (the Studio dashboard, task review panel, designer profile modal,
dashboard chat) has been built from the client's side only. The schema
has anticipated more than that from the start — `users.role` has included
`designer` and `staff`/`admin` since the first draft of this doc — but no
UI has ever been designed for either. Two concrete gaps this leaves:

1. **Nothing describes what actually advances a project through the 8
   pipeline stages.** The client can request revisions (task review
   panel); nothing on the designer's side moves a project from `matched`
   to `drafts_created` to `sent_to_client`. That's a missing mechanism,
   not just a missing screen.
2. **The AI QA "flagged-issues view" has always been described as living
   "in the dashboard" without saying which one.** Worth resolving now: a
   client almost certainly shouldn't see the raw AI-flagging process on
   their own project, only the final, cleared result. This view belongs
   on the staff dashboard, not the client one — see the correction to
   migration phase 7 below.

### Designer dashboard

Scoped to a `role: designer` user's own assigned work — never another
designer's projects, never a client's account.

- **Their project queue** — only projects where they're the assigned
  designer, pulled from `project_team`.
- **Per-project detail** — the brief, the client's uploaded assets, the
  deadline, and the full feedback/revision history from the task review
  panel (section on task feedback) and `chat_messages` (section 6).
- **Uploading their own draft/deliverable** — feeds into the `assets`
  table already scoped for AI QA (phase 7).
- **Advancing the project's stage** — the actual mechanism that's
  currently missing. A designer marking "drafts ready" is what should
  call `/api/project/:id/status` and move the project to
  `drafts_created`, triggering the client-facing notification (section 4).

### Staff / producer dashboard

Scoped to `role: staff` or `admin`. This is where several things already
designed elsewhere, but never given an interface, actually get operated:

- **Human hand-off queue** — every `human_handoff` status project (section
  5), so a producer can see what's waiting and manually assign a
  designer. Section 5 designed the data (`assigned_producer`) and the
  reasoning for why a named human handles this; this is the screen where
  that action actually happens.
- **AI QA flagged-issues review** — moved here explicitly, not left
  ambiguously "in the dashboard." A human reviewer approves, sends back,
  or overrides what the AI flagged (`qa_checks.status`), before anything
  reaches the client.
- **Site mode control** — a minimal UI for `/api/site-mode` (section 8),
  which otherwise has no interface at all beyond direct API calls.
- **Cross-client visibility** — overall queue and designer capacity across
  every client, not just one project at a time; the client and designer
  dashboards are both intentionally scoped to "their own," so this is the
  only place anyone sees the whole picture.

### Interaction with auth — resolved, not deferred

This is the one place "auth, last" doesn't fully hold. A designer's own
queue and a staff hand-off view can't exist with zero access control
distinguishing who's looking — so a minimal designer/staff auth (see
migration phase 7) needs to exist *before* these dashboards do, not after.
Client-facing auth is still genuinely fine to leave last (phase 11) —
nothing client-facing structurally needs it before then. The two aren't
the same phase, and treating them as one was the actual gap: role-based
access (a designer can't see another designer's queue; a client can't
load another client's project by guessing a URL) needs to be real from the
moment these dashboards ship, not patched in whenever auth "eventually"
happens.

---

## 10. Marketing consent — separate from functional notifications

**Decision: marketing use of an email address needs its own explicit,
opt-in consent — never bundled with, or inferred from, completing a
brief.** This isn't a style preference; it's a real GDPR distinction
worth building correctly from the start rather than retrofitting once a
list already exists.

### Why this can't just reuse `notify_email`

Collecting name and email to actually deliver a brief is covered under
"necessary for the contract" — no separate consent needed for that. Using
that same email for marketing afterward is a **different purpose**, and
under GDPR that generally needs its own distinct legal basis: explicit,
opt-in consent, captured separately from the functional signup. A
pre-ticked checkbox, or silently adding everyone who starts a brief to a
marketing list, is exactly the kind of thing that gets flagged in this
space — a real compliance gap, not a technicality, given the site already
targets EU clients with euro pricing.

### What's needed

- **Schema**: `marketing_opt_in` and `marketing_opt_in_at` on `clients`
  (above) — deliberately separate fields from `notify_email`/`notify_sms`,
  so declining marketing never accidentally also kills someone's project
  status updates, and vice versa. Conflating the two into one flag was the
  actual risk worth designing against here.
- **Capture point**: an explicit, **unticked** checkbox somewhere in the
  brief flow — e.g. *"Keep me updated on Aoibh news and offers"* —
  genuinely optional, never required to complete or submit a brief.
- **A real, working unsubscribe mechanism** once any marketing email
  actually goes out — the standard, expected way consent gets withdrawn
  later. Unsubscribing from marketing should only touch
  `marketing_opt_in`, never `notify_email`.
- **Privacy Policy update required before this ships** — `UI/privacy.html`
  currently only lists service delivery, project communication, and legal
  compliance as processing purposes (see its Section 2). It does not
  currently mention marketing use, because the feature doesn't exist yet
  — accurate for where things stand today, but it becomes inaccurate the
  moment this is built. Add marketing as an explicit purpose, with consent
  as its stated legal basis, **at the time this feature is actually
  built** — not preemptively now, and not left stale after.

### Scope note on "signs in"

The original ask covered both "starts a brief" and "signs in" — there's
no real client login yet (deliberately the last migration phase, section
9). This applies to the brief flow for now; the same consent principle
carries over unchanged whenever real sign-in eventually exists — it's not
a separate decision to make twice.

---

## 11. Migration path (suggested phases)

**Status per phase, corrected against section 0 (2026-09-04):** actual
build order didn't follow this list — payments (never in this list at all)
shipped ahead of tasks/status tracking, and the schema diverged from what
several phases below assume. Real status:

- Phase 1 (site mode switch) — **built, but broken** (missing `site_settings`
  grant, see section 0).
- Phase 2 (designers table) — **not done**, `ROSTER` still hardcoded, now
  duplicated across 2 files instead of 1.
- Phase 3 (early project creation) — **built, differently**: `briefs` rows
  are created at match time (inside `match-designer.js`), not via separate
  `clients`+`projects` rows at review-screen render as this phase
  describes. Functionally similar outcome (the lead is captured early),
  different mechanism.
- Phase 4 (persisted tasks) — **not done**.
- Phase 5 (request queue & status notifications) — **not done**. No
  `/api/project/new`, no multi-project dashboard, no status-change emails.
- Phase 6 (job-number lookup) — **not done**.
- Phase 7 (designer/staff dashboards + auth) — **not done**.
- Phase 8 (AI-assisted QA) — **not done** — no `brand_specs`/`qa_checks`,
  `deliverables` is a plain file pointer with no review step.
- Phase 9 (dashboard chat) — **not done**.
- Phase 10 (Slack) — **not done**.
- Phase 11 (client auth) — **not done**.
- Phase 12 (marketing consent) — **not done** — no checkbox in the brief
  flow, `privacy.html` still doesn't mention marketing use.
- **Not in this list at all, but built and live:** Stripe deposit/balance
  payments (`create-checkout.js` + `stripe-webhook.js`), a persisted
  dashboard reading real data (`dashboard.html`), and internal deliverable
  upload (`upload.html`). Worth treating payments as its own tracked phase
  going forward rather than leaving it undocumented, since it's now one of
  the most-built parts of the system.

Original phase descriptions kept below for reference on what each still
actually involves:

1. **Site mode switch, first.** Per section 8 — the middleware, the
   `site_settings` table, and at minimum "private" mode working. Placed
   before everything else deliberately: the moment Supabase is live and
   real project data starts flowing through it (phase 2 onward), you want
   the ability to keep that in-progress backend gated from public traffic
   already in place, not built after something's already been exposed
   prematurely.
2. **Designers table.** Move `ROSTER` out of `match-designer.js` and
   into the `designers` table. Lowest-risk change — the API's external
   behavior doesn't change at all.
3. **Project creation — earlier than the name suggests.** Per section 5,
   create the `clients` + `projects` row the moment the review screen
   renders (`status: matching` or `human_handoff`, whichever the match
   outcome was) — not only when "Approve & begin project" is clicked.
   That click becomes a status transition on an already-existing row, not
   the row's creation. This is a small but real change from the original
   plan of wiring creation straight to the approve click — worth building
   it this way from the start rather than shipping the simpler version and
   redoing it once the drop-off problem shows up in real usage.
4. **Persisted tasks.** Make the kanban board read/write through
   `/api/project/:id/tasks` instead of the seeded `studioTasksForBrief()`
   placeholder.
5. **Request queue & status notifications.** The two biggest gaps in the
   current build — see section 4 in full. Add `/api/project/new` with cap
   enforcement, turn the dashboard from a single-project view into a list,
   and wire `/api/project/:id/status` to email on the 8 pipeline stages.
   Placed here deliberately — right after tasks/projects are real, before
   anything else — since it changes the dashboard's basic shape rather than
   adding a feature to the existing one, and everything built afterward
   should assume it's already in place rather than retrofit around it.
6. **Job-number lookup.** Wire the triage branch's digit-detection to
   actually query `/api/project/:jobNumber`.
7. **Designer and staff dashboards — and the minimal auth they require.**
   Per section 9. This is the one place the "auth, last" plan (phase 11
   below) doesn't fully hold: a designer's own queue and a staff hand-off
   view can't exist with zero access control distinguishing who's looking.
   What's needed here is deliberately minimal, not the full client-facing
   auth system — a Supabase magic-link restricted to known
   designer/staff email addresses is enough to start, well short of
   building password reset flows, self-serve signup, or anything
   client-facing. This is what actually unblocks the stage-advancement
   mechanism phase 5 depends on.
8. **AI-assisted QA.** Add `brand_specs`, `assets`, and `qa_checks`, wire
   asset upload to `/api/qa-check`, and build the flagged-issues review
   into the **staff dashboard** from phase 7 — not the client-facing
   Studio dashboard. A client shouldn't see the raw AI-flagging process on
   their own project, only the cleared result. Human review (your own
   double-check) stays the final gate regardless of what the AI flags —
   see the open question below on how that split works.
9. **Dashboard chat.** Add `chat_messages` and `/api/project/:id/chat` —
   see section 6 for the logistics-only scope and the redirect logic for
   feedback-like messages. Worth doing after the task review panel exists
   (phase 4-adjacent work), since the redirect specifically links back to
   it.
10. **Slack (optional).** Add once phase 4 is done — see section 7.
11. **Client auth, last.** Add real client login once there's something
    worth logging in to see — a returning client's own project history,
    etc. This is the one still worth deferring: unlike phase 7's
    designer/staff access, nothing client-facing structurally requires it
    before then, so there's no reason to pull it earlier.
12. **Marketing consent capture.** Per section 10 — the
    `marketing_opt_in` field already exists on `clients` (section 2), so
    this is mostly a frontend addition: the unticked checkbox in the brief
    flow, plus an unsubscribe mechanism once any marketing email actually
    goes out. Low complexity, no dependency on other phases — genuinely
    fine to build whenever, just make sure `UI/privacy.html` gets its
    marketing-purpose clause added in the same piece of work, not after.

---

## 12. Open questions to settle before building

Worth deciding when this picks back up, since they shape the schema above:

- Do **clients** ever get real logins, or is the client-facing side always
  just an emailed link / no-login view?
- Do **designers** log in to update their own task statuses, or does staff
  manage that on their behalf?
- Is job-number lookup public (anyone who has the number can check status)
  or does it require the client's email to match too?
- Any compliance/data-residency requirements for client data, given the
  designer roster is genuinely global (Berlin, Melbourne, Belfast,
  Copenhagen)?
- For AI QA: does every asset need a human sign-off regardless of what the
  AI finds, or can high-confidence "cleared" assets skip your review
  entirely? The mockup assumes the latter (cleared items fade out of the
  queue) — worth confirming that's actually the workflow you want before
  it's built that way.
- For Slack: which events actually warrant a notification vs. just living
  in the dashboard? Posting every task move would get noisy fast — worth
  picking a short list (new brief, deadline warning, flagged QA issue) up
  front rather than everything.
- For the request queue: does a client see a warning as they approach their
  monthly cap (e.g. "1 of 3 projects used"), or only find out when a 4th
  submission is actually blocked? The friendlier version needs the cap
  count surfaced somewhere in the dashboard UI, not just enforced silently
  server-side.
- For SMS specifically: which provider (Twilio is the standard default),
  and which 1–2 stages actually justify the per-message cost — this
  shouldn't default to mirroring every email trigger without a deliberate
  decision.
- Does declining SMS opt-in ever block a client from anything, or is it
  purely additive on top of email/dashboard? (Recommended: purely
  additive — email + dashboard should always be enough on their own.)
- For producer hand-off: is `assigned_producer` a plain text field
  indefinitely, or does it need to become a real FK once there's more than
  a couple of people doing this? Fine to stay simple while the team is
  this small, but worth revisiting once a second producer exists and two
  people could plausibly pick up the same lead.
- For lead capture: how long does an unapproved `matching` /
  `human_handoff` row stay something worth following up on? At some point
  a lead that never converts is just abandoned, not "pending" — worth a
  stated cutoff (a status like `expired`, or simply excluding old
  unapproved rows from whatever view a producer works from) rather than
  leaving every never-approved brief permanently in an active-looking queue.
- Should `human_handoff` be added to the 8-stage notification enum in
  section 4, so the producer's own follow-up becomes a trackable,
  notifiable event like everything else — or is that moment meant to stay
  a manual, un-automated step on purpose, at least for now?
- For dashboard chat: the keyword heuristic for `flagged_as_feedback` will
  misfire in both directions at first — real logistics questions that
  happen to contain "change" or "different," and genuine feedback that
  doesn't use any of the obvious trigger words. Worth deciding upfront
  whether false negatives (feedback Aoibh answers directly, uncounted
  against the revision cap) or false positives (a logistics question
  wrongly redirected) is the safer failure mode to bias toward — they're
  not equally costly.
- For the site mode switch: who can actually flip it? Largely resolved by
  section 9 — once minimal designer/staff auth exists (migration phase 7),
  `/api/site-mode` can simply require `role: staff` or `admin` through
  that same mechanism, rather than needing a separate answer. The
  remaining gap is just the window between phase 1 (site mode switch) and
  phase 7 (staff auth) — worth a lightweight interim answer (a hardcoded
  secret header, a one-off CLI script) for that gap specifically, not a
  permanent solution.
- For private mode: does `private_access_code` ever rotate or expire, or
  is it one static code for the life of the pilot phase? A single
  long-lived code is simplest and probably fine for a small pilot group,
  but worth deciding rather than defaulting to it silently.
- For marketing consent: what happens to clients who signed up *before*
  this feature existed? They were never shown the checkbox at all, so
  `marketing_opt_in` would correctly default to `false` for all of
  them — meaning no retroactive opt-in, no re-permissioning campaign
  assumed here. Worth confirming that's genuinely the intended outcome
  (it's the compliant default) rather than something to revisit later
  once there's an actual pre-existing client base affected by it.
