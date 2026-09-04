# Aoibh

Aoibh is an AI + human creative production studio. This is the real,
deployed codebase — GitHub `marcello88c/Aoibh-UI`, deployed as the Vercel
project `aoibh-ui`. It replaces an earlier local copy (`Aoibh 2.0/`) that
fell behind once payments and persistence were built directly against
this repo instead. See `Research/backend-architecture-proposal.md` section
0 for the full reconciliation between what was originally planned and
what's actually here.

## Folder structure

- `index.html` — the marketing/intake site: hero, feed, process, stats,
  gallery, network, capabilities, pricing, cta. The brief flow lives here;
  on match it now redirects to `dashboard.html?id=<briefId>` rather than
  opening an in-page Studio section.
- `dashboard.html` — the real, persisted client dashboard. Reads a brief by
  `?id=<uuid>` via `api/dashboard-data.js`, no login. Renders
  deposit/in-progress/delivered states off `payment_status`. The pipeline
  status card is a placeholder — no live 8-stage tracking wired yet.
- `upload.html` — internal-only page for uploading deliverables against a
  brief (`api/upload-deliverable.js`). Not linked from the public site;
  don't share the link outside the studio.
- `maintenance.html` — static page served by `middleware.js` when
  `site_settings.mode = 'maintenance'`.
- `styles.css` — shared site CSS.
- `journal/` — the Journal (blog), separate indexable HTML pages, not an
  index.html section. `journal/index.html` is the listing page. New
  articles: create the file, add its card to `journal/index.html`'s grid,
  add its URL to `sitemap.xml`.
- `sitemap.xml`, `robots.txt` — reference `https://aoibh.ai/`.
- `middleware.js` — Vercel Edge Middleware, runs on every request except
  `/api/`, `/assets/`, and `maintenance.html` itself. Checks
  `api/site-mode.js` for the current mode and gates/redirects accordingly.
- `api/` — Vercel serverless functions:
  - `phrase-questions.js` — `POST /api/phrase-questions`
  - `match-designer.js` — `POST /api/match-designer` — also saves every
    completed brief to Supabase's `briefs` table and emails a lead
    notification via Resend
  - `dashboard-data.js` — `GET /api/dashboard-data?id=<briefId>` — no auth
  - `create-checkout.js` — `POST /api/create-checkout` — Stripe Checkout
    session for the deposit or balance stage
  - `stripe-webhook.js` — `POST /api/stripe-webhook` — reconciles
    `checkout.session.completed` against `briefs.payment_status`
  - `upload-deliverable.js` — `POST /api/upload-deliverable` — no auth
  - `contact.js` — `POST /api/contact` — writes to `contacts`, emails via
    Resend
  - `site-mode.js` — `GET/POST /api/site-mode` — reads/writes
    `site_settings`; POST requires `x-admin-secret` matching
    `SITE_MODE_ADMIN_SECRET`
- `Research/` — competitive research, notes, and the backend architecture
  proposal (now annotated with what's actually built vs. still planned).
- `Moodboards/` — visual inspiration (currently empty).

## Environment variables

Required (all set in Vercel already): `ANTHROPIC_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`,
`SITE_MODE_ADMIN_SECRET`. Not yet present in a local `.env.local` for this
folder — needed before running anything locally against real data.

## Database (Supabase)

Four tables live in production, all simpler than the schema
`Research/backend-architecture-proposal.md` sections 1–2 originally
proposed — see section 0 there for the full comparison:

- `briefs` — one row per completed brief. Answers, AI match result, and
  the full Stripe payment state (`payment_status`, `deposit_amount`,
  `balance_amount`, `stripe_deposit_session_id`,
  `stripe_balance_session_id`, `deposit_paid_at`, `balance_paid_at`) all
  live on this one table — no separate `clients`/`projects` split.
- `contacts` — footer contact-form submissions. `id`, `created_at`,
  `query`, `email` only.
- `deliverables` — file pointers (`brief_id`, `file_name`, `file_url`),
  written by `upload-deliverable.js`. No review/QA step.
- `site_settings` — single-row site mode config. **Currently has no
  Postgres `GRANT` for `service_role`** — every read from
  `api/site-mode.js` fails and silently falls back to `mode: "live"`. Fix
  before relying on mode-switching: `GRANT SELECT, UPDATE ON
  public.site_settings TO service_role;`

The designer roster is still a hardcoded `ROSTER` array — duplicated in
both `api/match-designer.js` and `api/dashboard-data.js`. Update both if a
designer changes.

## How the intake flow works

1. Visitor opens the brief modal → Aoibh asks for their **name**, then
   **email** (validated client-side).
2. **Triage question** (hardcoded on the frontend): *"Is this your first
   enquiry, or do you have a job number for a progress report?"*
   - **3+ digits detected** → hands off to a human producer, no further
     questions.
   - **No digits** → proceeds to step 3.
3. `phrase-questions.js` warmly rephrases the fixed 4-question set
   (project, budget, deadline, assets). Falls back to static copy on
   failure — never blocks the flow.
   - **Budget gate**: under €1,000 → hands off to a human producer.
4. All 4 answered → `match-designer.js` picks a designer from `ROSTER`,
   scores confidence, **saves the brief to Supabase**, emails a lead
   notification. On failure, a deterministic `fallbackMatch()` covers it.
   - **80% confidence threshold** — below it, hands off to a human
     producer.
5. On match, the frontend redirects to `dashboard.html?id=<briefId>` — a
   real page reading real data, not an in-memory view.
6. From the dashboard, "pay deposit" / "pay balance" calls
   `create-checkout.js` → Stripe Checkout → `stripe-webhook.js` updates
   `payment_status` on completion.

Both AI endpoints use `model: "claude-sonnet-5"`, an 8s timeout, and
"fail soft" behavior — never 500 the client just because Claude or the
network misbehaves. Keep that convention in any new endpoint.

## Open items

See `Research/backend-architecture-proposal.md` section 0 for the full,
current reconciliation of what's built vs. planned, and its list of known
issues (the `site_settings` grant, dead duplicate files, missing auth on
`dashboard-data`/`upload-deliverable`, a couple of malformed
`deliverables.file_url` rows). Sections 1–10 of that document remain the
best reference for what *isn't* built yet: formal 8-stage pipeline
tracking, AI-assisted QA, dashboard chat, designer/staff dashboards and
their minimal auth, client auth, and marketing consent capture.

`terms.html`, `privacy.html` — working drafts, both carry a visible
"not yet reviewed by a lawyer" notice and bracketed placeholders. Fill
those in and get real legal review before removing the draft notice.
