// api/create-checkout.js
//
// Creates a Stripe Checkout session for a trial project. Called twice per
// project across its lifecycle:
//   1. Before work starts   -> stage = 'deposit'  (30% of €695)
//   2. After preview review -> stage = 'balance'  (remaining 70%)
//
// SETUP NEEDED:
// 1. npm install stripe @supabase/supabase-js
// 2. Env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//    SITE_URL (e.g. https://aoibh.ai)
// 3. briefs table has the payment_status / amount / session-id columns
//    from schema-updates.sql

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TRIAL_TOTAL_CENTS = 69500; // €695.00
const DEPOSIT_RATE = 0.3;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { briefId, stage } = req.body; // stage: 'deposit' | 'balance'

    if (!briefId || !['deposit', 'balance'].includes(stage)) {
      return res.status(400).json({ error: 'briefId and a valid stage are required' });
    }

    const { data: brief, error: fetchError } = await supabase
      .from('briefs')
      .select('id, email, payment_status')
      .eq('id', briefId)
      .single();

    if (fetchError || !brief) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Guard against re-charging a stage that's already been paid, or
    // requesting the balance before the deposit has cleared.
    if (stage === 'deposit' && brief.payment_status !== 'pending') {
      return res.status(400).json({ error: 'Deposit already paid for this project' });
    }
    if (stage === 'balance' && brief.payment_status !== 'deposit_paid') {
      return res.status(400).json({ error: 'Deposit must be paid before the balance is due' });
    }

    const depositCents = Math.round(TRIAL_TOTAL_CENTS * DEPOSIT_RATE);
    const balanceCents = TRIAL_TOTAL_CENTS - depositCents;
    const amountCents = stage === 'deposit' ? depositCents : balanceCents;
    const productName = stage === 'deposit'
      ? 'Aoibh Trial Project — Deposit (30%)'
      : 'Aoibh Trial Project — Final Balance (70%)';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: brief.email || undefined,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: productName },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: { briefId, stage },
      success_url: `${process.env.SITE_URL}/dashboard/${briefId}?payment=success&stage=${stage}`,
      cancel_url: `${process.env.SITE_URL}/dashboard/${briefId}?payment=cancelled`,
    });

    // Store the session id and amount so the webhook can reconcile it,
    // and so re-requesting checkout doesn't lose track of the amount owed.
    const sessionColumn = stage === 'deposit' ? 'stripe_deposit_session_id' : 'stripe_balance_session_id';
    const amountColumn = stage === 'deposit' ? 'deposit_amount' : 'balance_amount';

    const { error: updateError } = await supabase
      .from('briefs')
      .update({ [sessionColumn]: session.id, [amountColumn]: amountCents })
      .eq('id', briefId);

    if (updateError) throw updateError;

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Could not create checkout session' });
  }
}
