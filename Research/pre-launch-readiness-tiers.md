# Pre-Launch Readiness — Aoibh vs. a Real Competitor (Design Pickle)

Status: **Reference checklist. Not started.** Written after comparing the
current build honestly against a mature, live competitor. Come back to this
before actually taking the site live — it's the gap between "looks like a
real product" and "is one."

## Why this exists

Aoibh right now is a genuinely well-built **front-end demo of the
experience** — the vision is clear and the polish is real, but there's a
meaningful gap between that and a live, sellable business. This doc breaks
that gap into three tiers, roughly in the order to tackle them.

---

## Tier 1 — Would actually block a real launch

1. **A real backend.** Everything else depends on this. Right now every
   "project," every dashboard, every file upload lives in browser memory
   and vanishes on refresh. See `Research/backend-architecture-proposal.md`
   — it's already scoped, just not built.
2. **Real payment processing.** There's a pricing page with real euro
   amounts, but no actual way to charge anyone. Stripe (or similar) is
   non-negotiable before taking a single real subscriber.
3. **Terms of Service, Privacy Policy, and a cancellation/refund policy.**
   Working drafts now exist (`UI/terms.html`, `UI/privacy.html`) — but
   neither has been reviewed by a lawyer, and both are full of bracketed
   placeholders ([LEGAL ENTITY NAME], [JURISDICTION], etc.) that need real
   business input. Not optional — the brief flow collects names, emails,
   budgets, and files, which is personal data under GDPR, especially given
   the euro pricing targets EU clients. Processing payments and personal
   data on unreviewed drafts is still real legal exposure.
4. **A way for a client to log back in.** The dashboard only exists for one
   browser session right now. A real client needs to close their laptop and
   come back days later — that needs real auth, already scoped as the last
   migration phase in the backend proposal doc, but it can't stay unbuilt
   forever.

## Tier 2 — The core product gap Design Pickle actually solves

5. **A real request queue, not a one-shot brief.** The biggest *product*
   gap, not just technical. The pricing tiers promise "up to 3 projects per
   month," but there's no way inside the dashboard today for a client to
   submit request #2 while #1 is in progress. Design Pickle's whole value
   prop is "submit unlimited requests into a queue, we work through them."
   Aoibh's flow is currently architected as a single intake form, not a
   queue. Needs real product thinking, not just backend work.
6. **Status notifications.** Once a client leaves the page, they hear
   nothing until they think to check back. At minimum, an email when a
   draft is ready.

## Tier 3 — Trust and credibility signals

7. **Real portfolio work, not other studios' images.** The showcase strip
   and capability tiles currently use other designers' actual client work
   as visual placeholders. Fine for an internal demo — cannot go live as-is,
   since it would misrepresent whose work it is. Needs either real Aoibh
   output, or licensed stock explicitly framed as illustrative, not implied
   as the studio's own portfolio.
8. **Real testimonials and client names.** NORDKIND, VANTAGE, HALCYON etc.
   are fictional. Same underlying issue as why the competitor comparison
   chart was parked (see `Research/comparison-content-parked.md`) — no real
   proof points yet.
9. **An FAQ section.** Addressing real objections (what if I don't like the
   direction, can I pause, what happens to unused revisions) — standard on
   every subscription-creative-service site for a reason, and closes sales.

## What's already in good shape — leave alone for now

The Studio dashboard's design, the brief flow's conversational feel, the
pricing structure, and the brand system don't need more polish before
launch. The gap isn't "make it prettier" — it's "make the promises the site
already makes actually true."

## If starting with just one thing

The backend — specifically with **request-queue support baked into the
schema from the start**, not bolted on after. A project needs to support
multiple linked requests, not just one; retrofitting that later means
reworking the data model rather than extending it.
