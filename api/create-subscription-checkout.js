// api/create-subscription-checkout.js
//
// Creates a Stripe Checkout session to start a new Starter/Growth
// subscription. Pay-first: unlike the trial project (where a brief
// already exists and this is called against it), no brief and no
// subscriber row exist yet at this point — the subscriber row is only
// created once api/stripe-webhook.js confirms payment actually cleared.
//
// Env vars needed: STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER,
// STRIPE_PRICE_GROWTH, SITE_URL.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TIER_PRICES = {
  starter: process.env.STRIPE_PRICE_STARTER,
  growth: process.env.STRIPE_PRICE_GROWTH,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, tier } = req.body || {};
    const cleanEmail = (email || '').trim();

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!TIER_PRICES[tier]) {
      return res.status(400).json({ error: 'tier must be starter or growth' });
    }
    if (!TIER_PRICES[tier].startsWith('price_')) {
      return res.status(500).json({ error: `STRIPE_PRICE_${tier.toUpperCase()} is not configured` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: cleanEmail,
      line_items: [{ price: TIER_PRICES[tier], quantity: 1 }],
      metadata: { tier },
      success_url: `${process.env.SITE_URL}/subscriber-login.html?subscribed=1`,
      cancel_url: `${process.env.SITE_URL}/#pricing`,
    });

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('create-subscription-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Could not create checkout session' });
  }
}
