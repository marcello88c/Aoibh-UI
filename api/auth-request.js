// POST /api/auth-request
// Body: { email }
// If the submitted email matches STAFF_ADMIN_EMAIL (case-insensitive),
// creates a single-use magic-link token and emails a sign-in link via
// Resend. Always responds the same way regardless of match, so this
// endpoint can't be used to probe which email has access.

import crypto from "crypto";

async function supabaseFetch(path, options = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function sendMagicLinkEmail(to, url) {
  if (!process.env.RESEND_API_KEY) {
    console.error("sendMagicLinkEmail skipped: RESEND_API_KEY not set");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Aoibh <hello@aoibh.ai>",
        to: [to],
        subject: "Your Aoibh sign-in link",
        text: `Sign in here (expires in 15 minutes):\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
      }),
    });
    if (!res.ok) {
      console.error("sendMagicLinkEmail rejected by Resend:", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendMagicLinkEmail failed:", err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const email = ((req.body && req.body.email) || "").trim().toLowerCase();
  const adminEmail = (process.env.STAFF_ADMIN_EMAIL || "").trim().toLowerCase();

  if (email && adminEmail && email === adminEmail) {
    try {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const insertRes = await supabaseFetch("magic_links", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ token, email, expires_at: expiresAt }),
      });
      if (!insertRes.ok) {
        console.error("auth-request insert error:", insertRes.status, await insertRes.text());
      } else {
        const link = `${process.env.SITE_URL}/api/auth-verify?token=${token}`;
        await sendMagicLinkEmail(email, link);
      }
    } catch (err) {
      console.error("auth-request failed:", err.message);
    }
  }

  return res.status(200).json({ ok: true });
}
