// GET /api/auth-verify?token=<token>
// Verifies a magic-link token (single-use, 15-minute expiry), creates a
// 30-day staff session, sets the session cookie, and redirects to the
// staff hub. Reached only by clicking the link emailed by auth-request.js.

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const token = ((req.query && req.query.token) || "").trim();
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.redirect(302, "/login.html?error=invalid_link");
  }

  try {
    const linkRes = await supabaseFetch(
      `magic_links?token=eq.${encodeURIComponent(token)}&select=email,expires_at,used_at&limit=1`
    );
    if (!linkRes.ok) throw new Error(`lookup failed: ${linkRes.status}`);
    const rows = await linkRes.json();
    const link = rows[0];

    if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
      return res.redirect(302, "/login.html?error=expired_link");
    }

    await supabaseFetch(`magic_links?token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    });

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessionRes = await supabaseFetch("staff_sessions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ token: sessionToken, email: link.email, expires_at: sessionExpiresAt }),
    });
    if (!sessionRes.ok) throw new Error(`session insert failed: ${sessionRes.status}`);

    const cookie = [
      `aoibh_staff_session=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${30 * 24 * 60 * 60}`,
    ].join("; ");
    res.setHeader("Set-Cookie", cookie);

    return res.redirect(302, "/staff.html");
  } catch (err) {
    console.error("auth-verify failed:", err.message);
    return res.redirect(302, "/login.html?error=server_error");
  }
}
