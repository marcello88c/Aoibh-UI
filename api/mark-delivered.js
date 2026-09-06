// POST /api/mark-delivered
// Body: { briefId }
// Sets a brief's status to "delivered" — the same flag dashboard.html
// checks (alongside deliverables existing) to show the completed/
// download-list state — and emails the client that their project is
// ready.
//
// Replaces hand-editing briefs.status in Supabase's table editor
// (upload.html used to just remind the producer to do that manually,
// which was easy to forget and had no side effect). Requires at least
// one deliverables row to already exist, matching dashboard.html's own
// isDelivered condition — no point marking something delivered with
// nothing to show for it.
//
// Requires an `x-admin-secret` header matching SITE_MODE_ADMIN_SECRET —
// same interim admin gate as api/site-mode.js and api/upload-deliverable.js.

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const providedSecret = req.headers["x-admin-secret"];
  const ADMIN_SECRET = process.env.SITE_MODE_ADMIN_SECRET;
  if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const briefId = ((req.body && req.body.briefId) || "").trim();
  if (!briefId) {
    return res.status(400).json({ error: "Missing briefId" });
  }

  try {
    const deliverablesRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/deliverables?brief_id=eq.${encodeURIComponent(briefId)}&select=id&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );
    if (!deliverablesRes.ok) {
      console.error("mark-delivered deliverables check error:", deliverablesRes.status, await deliverablesRes.text());
      return res.status(502).json({ error: "Failed to check deliverables" });
    }
    const deliverableRows = await deliverablesRes.json();
    if (deliverableRows.length === 0) {
      return res.status(400).json({ error: "No deliverables uploaded for this project yet — upload the final files first." });
    }

    const patchRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status: "delivered" }),
      }
    );
    if (!patchRes.ok) {
      console.error("mark-delivered brief update error:", patchRes.status, await patchRes.text());
      return res.status(502).json({ error: "Failed to update project status" });
    }
    const rows = await patchRes.json();
    const brief = rows[0];
    if (!brief) {
      return res.status(404).json({ error: "Project not found" });
    }

    const dashboardUrl = `${process.env.SITE_URL}/dashboard.html?id=${briefId}&email=${encodeURIComponent(brief.email || "")}`;
    await sendClientEmail({
      to: brief.email,
      subject: "Your project is complete",
      text: `Hi ${brief.name || "there"},\n\nYour project is done — full-resolution files are unlocked and ready to download.\n\nView and download them here: ${dashboardUrl}\n\nThanks for trying Aoibh.\n\n— Aoibh`,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("mark-delivered failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
