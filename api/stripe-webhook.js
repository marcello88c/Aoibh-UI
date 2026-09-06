// api/stripe-webhook.js
//
// Handles Stripe's checkout.session.completed event for both the deposit
// and balance stages, and updates the project's payment_status accordingly.
//
// SETUP NEEDED:
// 1. npm install stripe @supabase/supabase-js
// 2. Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 3. In Stripe Dashboard: Developers -> Webhooks -> Add endpoint
//    pointing to https://aoibh.ai/api/stripe-webhook, subscribed to
//    "checkout.session.completed"
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

// Same roster as match-designer.js/dashboard-data.js — duplicated for the
// same reason: serverless functions can't share module state without a
// shared package setup. Only need names here, not full profiles.
const DESIGNER_NAMES = {
  "eve-berlin": "Eve", "zac-sf": "Zac", "nicole-paris": "Nicole",
  "gemma-melbourne": "Gemma", "marc-belfast": "Marc", "naomi-copenhagen": "Naomi",
};

async function sendClientEmail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY || !to) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: "Aoibh <hello@aoibh.ai>", to: [to], subject, text }),
    });
  } catch (err) {
    console.error("sendClientEmail failed:", err.message);
  }
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

  if (event.type !== 'checkout.session.completed') {
    // Not an event this endpoint cares about — acknowledge and skip.
    return res.status(200).json({ received: true, skipped: true });
  }

  try {
    const session = event.data.object;
    const { briefId, stage } = session.metadata || {};

    if (!briefId || !stage) {
      console.error('Webhook missing briefId/stage metadata', session.id);
      return res.status(200).json({ received: true, skipped: true });
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
        const designerName = DESIGNER_NAMES[brief.matched_designer_id] || "your designer";
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

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe-webhook handling error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
