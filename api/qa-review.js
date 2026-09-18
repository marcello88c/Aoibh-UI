// GET  /api/qa-review — lists flagged qa_checks (status='flagged'), newest
//      first, with the related brief's project/client context embedded.
// POST /api/qa-review — body: { id, status, reviewedBy }. status must be
//      'approved_by_human' or 'sent_back'. Records the human decision —
//      the actual gate before a client ever sees anything AI flagged.
//
// Requires a valid aoibh_staff_session cookie (see api/auth-session.js) —
// real staff auth, replacing the old shared x-admin-secret gate.

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function requireStaffSession(req) {
  const token = getCookie(req, "aoibh_staff_session");
  if (!token) return null;
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/staff_sessions?token=eq.${encodeURIComponent(token)}&select=email,expires_at&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const session = rows[0];
    if (!session || new Date(session.expires_at) < new Date()) return null;
    return session.email;
  } catch (err) {
    console.error("requireStaffSession failed:", err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const staffEmail = await requireStaffSession(req);
  if (!staffEmail) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (req.method === "GET") {
    try {
      const qaRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/qa_checks?status=eq.flagged&select=id,brief_id,kind,file_url,file_name,issue_type,confidence,detail,created_at,briefs(name,email,answers)&order=created_at.desc`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        }
      );
      if (!qaRes.ok) {
        console.error("qa-review list error:", qaRes.status, await qaRes.text());
        return res.status(502).json({ error: "Failed to fetch flagged items" });
      }
      const rows = await qaRes.json();
      return res.status(200).json({ items: rows });
    } catch (err) {
      console.error("qa-review list failed:", err.message);
      return res.status(500).json({ error: "Unexpected error" });
    }
  }

  if (req.method === "POST") {
    const { id, status, reviewedBy } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    if (!["approved_by_human", "sent_back"].includes(status)) {
      return res.status(400).json({ error: "status must be approved_by_human or sent_back" });
    }

    try {
      const patchRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/qa_checks?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status,
          reviewed_by: (reviewedBy || "").trim() || null,
          reviewed_at: new Date().toISOString(),
        }),
      });
      if (!patchRes.ok) {
        const text = await patchRes.text();
        console.error("qa-review update error:", patchRes.status, text);
        return res.status(502).json({ error: "Failed to update item" });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("qa-review update failed:", err.message);
      return res.status(500).json({ error: "Unexpected error" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
