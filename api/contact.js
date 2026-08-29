// POST /api/contact
// Body: { query, email }
// Saves the submission to Supabase's `contacts` table (if configured) and
// sends a notification email via Resend — mirrors the same pattern as
// saveBrief() in match-designer.js. Fails soft: if Supabase or Resend has
// a problem, we log it and still return success to the visitor, since the
// "Talk to the studio" widget always shows the same reassuring message
// regardless.
//
// NOTE: requires a `contacts` table in Supabase with columns:
// id (uuid, default gen_random_uuid()), created_at (timestamptz, default now()),
// query (text), email (text)
// If that table doesn't exist yet, the Supabase save will fail and log an
// error, but the email notification will still go through.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = (req.body && req.body.query || "").trim();
  const email = (req.body && req.body.email || "").trim();

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supaRes = await fetch(process.env.SUPABASE_URL + "/rest/v1/contacts", {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ query: query || null, email: email || null }),
      });
      if (!supaRes.ok) {
        console.error("saveContact supabase error:", supaRes.status, await supaRes.text());
      }
    } catch (err) {
      console.error("saveContact failed:", err.message);
    }
  }

  if (process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Aoibh Leads <leads@aoibh.ai>",
          to: ["hello@aoibh.ai"],
          subject: `New contact request from ${email || "unknown"}`,
          text: `New "Talk to the studio" submission.\n\nEmail: ${email || "—"}\n\nQuery: ${query || "—"}`,
        }),
      });
    } catch (err) {
      console.error("sendContactEmail failed:", err.message);
    }
  }

  return res.status(200).json({ ok: true });
}
