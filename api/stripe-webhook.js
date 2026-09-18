// api/stripe-webhook.js
//
// Handles Stripe's checkout.session.completed event for both the trial
// project (deposit/balance, mode='payment') and new subscriptions
// (mode='subscription'), plus customer.subscription.updated/deleted for
// keeping a subscriber's status and billing period in sync afterward.
//
// SETUP NEEDED:
// 1. npm install stripe @supabase/supabase-js
// 2. Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 3. In Stripe Dashboard: Developers -> Webhooks -> Add endpoint
//    pointing to https://aoibh.ai/api/stripe-webhook, subscribed to
//    "checkout.session.completed", "customer.subscription.updated", and
//    "customer.subscription.deleted"
// 4. IMPORTANT: Vercel functions parse the body as JSON by default, but
//    Stripe signature verification needs the *raw* body. The config
//    below disables the default body parser for this route.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Fallback only, if Supabase's `designers` table can't be reached.
const FALLBACK_DESIGNER_NAMES = {
  "eve-berlin": "Eve", "zac-sf": "Zac", "nicole-paris": "Nicole",
  "gemma-melbourne": "Gemma", "marc-belfast": "Marc", "naomi-copenhagen": "Naomi",
};

// Looks up just designer names from Supabase's `designers` table — the
// real source of truth (see api/match-designer.js and
// api/dashboard-data.js, which read the same table for full profiles).
async function fetchDesignerNames() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return FALLBACK_DESIGNER_NAMES;
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/designers?role=eq.designer&select=id,name`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!res.ok) {
      console.error("fetchDesignerNames error:", res.status, await res.text());
      return FALLBACK_DESIGNER_NAMES;
    }
    const rows = await res.json();
    if (rows.length === 0) return FALLBACK_DESIGNER_NAMES;
    return Object.fromEntries(rows.map((d) => [d.id, d.name]));
  } catch (err) {
    console.error("fetchDesignerNames failed:", err.message);
    return FALLBACK_DESIGNER_NAMES;
  }
}

async function sendClientEmail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.error("sendClientEmail skipped: RESEND_API_KEY not set");
    return;
  }
  if (!to) {
    console.error("sendClientEmail skipped: no recipient email");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: "Aoibh <hello@aoibh.ai>", to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error("sendClientEmail rejected by Resend:", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendClientEmail failed:", err.message);
  }
}

// Stripe's subscription.status has more values than we need to expose —
// collapse to the three subscribers.status allows. Unrecognized statuses
// fall to 'past_due' (blocks new projects) rather than 'active', since
// that's the safer default for a status we didn't anticipate.
function normalizeSubscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired') return 'canceled';
  return 'past_due';
}

const TIER_NAMES = { starter: 'Starter', growth: 'Growth' };

async function handleTrialCheckout(session) {
  const { briefId, stage } = session.metadata || {};

  if (!briefId || !stage) {
    console.error('Webhook missing briefId/stage metadata', session.id);
    return;
  }

  if (stage === 'deposit') {
    const { data: brief, error } = await supabase
      .from('briefs')
      .update({
        payment_status: 'deposit_paid',
        deposit_paid_at: new Date().toISOString(),
      })
      .eq('id', briefId)
      .eq('stripe_deposit_session_id', session.id) // extra safety check
      .select('email, name, matched_designer_id')
      .single();

    if (error) throw error;

    if (brief) {
      const designerNames = await fetchDesignerNames();
      const designerName = designerNames[brief.matched_designer_id] || "your designer";
      const dashboardUrl = `${process.env.SITE_URL}/dashboard.html?id=${briefId}&email=${encodeURIComponent(brief.email || "")}`;
      await sendClientEmail({
        to: brief.email,
        subject: "Your deposit is confirmed — work is starting",
        text: `Hi ${brief.name || "there"},\n\nYour deposit has cleared and ${designerName} is getting started on your project right away.\n\nTrack progress here: ${dashboardUrl}\n\n— Aoibh`,
      });
    }
  } else if (stage === 'balance') {
    const { error } = await supabase
      .from('briefs')
      .update({
        payment_status: 'paid_in_full',
        balance_paid_at: new Date().toISOString(),
      })
      .eq('id', briefId)
      .eq('stripe_balance_session_id', session.id);

    if (error) throw error;

    // TODO: unlock full-resolution files here — e.g. flip a `files_unlocked`
    // flag the dashboard checks before generating signed download URLs.
  }
}

// New Starter/Growth subscription just paid for the first time. No
// subscriber row exists yet — pay-first means this webhook is what
// actually creates it, not a client-side call beforehand (unlike the
// trial project, which writes its session id onto an already-existing
// brief). Deliberately does NOT create/insert a subscriber row on
// customer.subscription.created — keeping creation to this one event
// avoids a race between two events both trying to insert the same row.
async function handleSubscriptionCheckout(session) {
  const { tier } = session.metadata || {};
  const email = session.customer_details?.email || session.customer_email;

  if (!tier || !email || !session.subscription) {
    console.error('Webhook missing tier/email/subscription on subscription checkout', session.id);
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  const { error } = await supabase.from('subscribers').insert({
    email,
    tier,
    status: normalizeSubscriptionStatus(subscription.status),
    stripe_customer_id: session.customer,
    stripe_subscription_id: session.subscription,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  });

  if (error) {
    // Most likely cause: this email already has a subscribers row (unique
    // constraint) — e.g. a double-submit of the checkout button. Payment
    // already succeeded either way, so just log rather than fail the
    // webhook (Stripe would otherwise retry indefinitely).
    console.error('handleSubscriptionCheckout insert error:', error.message);
    return;
  }

  const tierName = TIER_NAMES[tier] || tier;
  await sendClientEmail({
    to: email,
    subject: `You're subscribed to Aoibh ${tierName}`,
    text: `Hi,\n\nYour ${tierName} subscription is active. Sign in any time to start a project:\n\n${process.env.SITE_URL}/subscriber-login.html\n\nJust enter this email address and we'll send you a sign-in link.\n\n— Aoibh`,
  });
}

// Keeps status and billing-period dates in sync on renewal, plan change,
// or a failed payment — the project-cap check (Phase 4) counts briefs
// created within [current_period_start, current_period_end), so keeping
// these dates current is what makes the cap reset each period, without a
// separate "reset the counter" step anywhere.
async function handleSubscriptionUpdated(subscription) {
  const { error } = await supabase
    .from('subscribers')
    .update({
      status: normalizeSubscriptionStatus(subscription.status),
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) console.error('handleSubscriptionUpdated error:', error.message);
}

async function handleSubscriptionDeleted(subscription) {
  const { error } = await supabase
    .from('subscribers')
    .update({ status: 'canceled' })
    .eq('stripe_subscription_id', subscription.id);

  if (error) console.error('handleSubscriptionDeleted error:', error.message);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let event;
  try {
    const rawBody = await buffer(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription') {
        await handleSubscriptionCheckout(session);
      } else {
        await handleTrialCheckout(session);
      }
      return res.status(200).json({ received: true });
    }

    if (event.type === 'customer.subscription.updated') {
      await handleSubscriptionUpdated(event.data.object);
      return res.status(200).json({ received: true });
    }

    if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionDeleted(event.data.object);
      return res.status(200).json({ received: true });
    }

    // Not an event this endpoint cares about — acknowledge and skip.
    return res.status(200).json({ received: true, skipped: true });
  } catch (err) {
    console.error('stripe-webhook handling error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
