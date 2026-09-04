// GET /api/dashboard-data?id=<brief_id>&email=<client_email>
// Returns the real, saved brief record from Supabase's `briefs` table,
// cross-referenced with the matched designer's full profile (name, title,
// photo) from the same roster used in match-designer.js.
//
// UPDATED: now also returns the trial payment state (payment_status,
// deposit/balance amounts, preview_urls) so dashboard.html can render the
// deposit / in-progress-preview / delivered states correctly.
//
// NOTE — interim, not full auth: this endpoint requires `email` to match
// the brief's stored email, so a brief id alone (however unguessable the
// uuid is) is no longer enough on its own. This is a stopgap, not real
// client auth (migration phase 11, deliberately deferred) — it stops
// casual/opportunistic access to a stray id, not a targeted attacker who
// already knows the client's email too. Good enough for today's real
// gap (an id with no check at all); revisit once real client auth exists.

// Same roster as match-designer.js — duplicated here because serverless
// functions can't share module state across files without a shared
// package setup. If the roster changes, update both files.
const ROSTER = [
  { id: "eve-berlin", name: "Eve", title: "Brand Identity Designer", location: "Berlin, DE", img: "assets/designers/eve_berlin.jpeg" },
  { id: "zac-sf", name: "Zac", title: "Product & UX Designer", location: "San Francisco, US", img: "assets/designers/zac_melbourne.jpg" },
  { id: "nicole-paris", name: "Nicole", title: "Web & Editorial Designer", location: "Paris, FR", img: "assets/designers/nicole_paris.jpeg" },
  { id: "gemma-melbourne", name: "Gemma", title: "Motion & Video Designer", location: "Melbourne, AU", img: "assets/designers/gemma_melbourne.jpeg" },
  { id: "marc-belfast", name: "Marc", title: "Packaging & Print Designer", location: "Belfast, UK", img: "assets/designers/marc_belfast.jpeg" },
  { id: "naomi-copenhagen", name: "Naomi", title: "Illustration & Social Content Designer", location: "Copenhagen, DK", img: "assets/designers/naomi_copenhagen.jpeg" },
];

// Same art director roster as match-designer.js — duplicated for the same
// reason as ROSTER above.
const ART_DIRECTOR_ROSTER = [
  { id: "hannah-london", name: "Hannah", location: "London, UK", img: "assets/designers/hanna_london.jpeg" },
  { id: "michael-manchester", name: "Michael", location: "Manchester, UK", img: "assets/designers/michael_manchester.jpeg" },
  { id: "tina-amsterdam", name: "Tina", location: "Amsterdam, NL", img: "assets/designers/Tina_amsterdam.jpeg" },
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = (req.query && req.query.id || "").trim();
  const email = (req.query && req.query.email || "").trim().toLowerCase();
  if (!id) {
    return res.status(400).json({ error: "Missing required query param: id" });
  }
  if (!email) {
    return res.status(400).json({ error: "Missing required query param: email" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    const supaRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );

    if (!supaRes.ok) {
      const text = await supaRes.text();
      console.error("dashboard-data supabase error:", supaRes.status, text);
      return res.status(502).json({ error: "Failed to fetch brief" });
    }

    const rows = await supaRes.json();
    const brief = rows[0];

    if (!brief) {
      return res.status(404).json({ error: "Brief not found" });
    }

    if ((brief.email || "").trim().toLowerCase() !== email) {
      // Same response as "not found" — don't reveal whether the id
      // exists to a caller who doesn't already know the right email.
      return res.status(404).json({ error: "Brief not found" });
    }

    const designer = ROSTER.find((d) => d.id === brief.matched_designer_id) || null;
    const artDirector = ART_DIRECTOR_ROSTER.find((a) => a.id === brief.art_director_id) || null;

    let deliverables = [];
    try {
      const delivRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/deliverables?brief_id=eq.${encodeURIComponent(id)}&select=*`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        }
      );
      if (delivRes.ok) {
        deliverables = await delivRes.json();
      } else {
        console.error("dashboard-data deliverables fetch error:", delivRes.status, await delivRes.text());
      }
    } catch (err) {
      console.error("dashboard-data deliverables fetch failed:", err.message);
    }

    return res.status(200).json({
      id: brief.id,
      name: brief.name,
      email: brief.email,
      answers: brief.answers,
      designer,
      artDirector,
      matchReason: brief.match_reason,
      confidence: brief.confidence,
      source: brief.source,
      createdAt: brief.created_at,
      status: brief.status || "in_progress",
      deliverables: deliverables.map((d) => ({ name: d.file_name, url: d.file_url })),

      // Trial payment state — drives which screen dashboard.html shows.
      // payment_status: 'pending' | 'deposit_paid' | 'paid_in_full'
      paymentStatus: brief.payment_status || "pending",
      depositAmount: brief.deposit_amount,   // in cents
      balanceAmount: brief.balance_amount,   // in cents
      previewUrls: brief.preview_urls || null, // { plain, laptop, mobile, social }
    });
  } catch (err) {
    console.error("dashboard-data failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
