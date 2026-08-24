// GET /api/dashboard-data?id=<brief_id>
// Returns the real, saved brief record from Supabase's `briefs` table,
// cross-referenced with the matched designer's full profile (name, title,
// photo) from the same roster used in match-designer.js.
//
// NOTE — temporary/no-auth: this endpoint currently trusts whatever brief
// id is passed in the URL, with no login or ownership check. It exists so
// dashboard.html can show one real project's real data today. Before this
// is used for real clients, it needs a proper auth layer so a client can
// only ever fetch their own brief id, not any id in the table.

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = (req.query && req.query.id || "").trim();
  if (!id) {
    return res.status(400).json({ error: "Missing required query param: id" });
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

    const designer = ROSTER.find((d) => d.id === brief.matched_designer_id) || null;

    return res.status(200).json({
      id: brief.id,
      name: brief.name,
      email: brief.email,
      answers: brief.answers,
      designer,
      matchReason: brief.match_reason,
      confidence: brief.confidence,
      source: brief.source,
      createdAt: brief.created_at,
    });
  } catch (err) {
    console.error("dashboard-data failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
