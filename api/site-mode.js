// GET/POST /api/site-mode
// GET  → { mode, maintenance_message } — called by middleware.js on every
//         request (with a short client-side cache — see middleware.js).
// POST → { mode, private_access_code?, maintenance_message? } — updates
//         the single site_settings row. Requires a matching
//         x-admin-secret header until real staff auth exists (migration
//         phase 7) — see Research/backend-architecture-proposal.md
//         section 8 and its open questions for why this is deliberately
//         a stopgap, not the permanent access-control answer.
//
// Talks to a single-row Supabase table, `site_settings` (id always 1).
// Requires two environment variables in Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// and one more for the temporary admin gate:
//   SITE_MODE_ADMIN_SECRET

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_SECRET = process.env.SITE_MODE_ADMIN_SECRET;

const VALID_MODES = ["live", "beta", "private", "maintenance"];

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // No database configured yet (e.g. before Supabase is set up) —
    // fail open to "live" rather than accidentally locking the whole
    // site behind a gate that can never be satisfied.
    if (req.method === "GET") {
      return res.status(200).json({ mode: "live", maintenance_message: null });
    }
    return res.status(503).json({ error: "Supabase not configured yet" });
  }

  if (req.method === "GET") {
    try {
      const rows = await supabaseFetch(
        "site_settings?id=eq.1&select=mode,maintenance_message,private_access_code"
      );
      const row = rows[0];
      if (!row) throw new Error("no site_settings row found");

      const mode = VALID_MODES.includes(row.mode) ? row.mode : "live";
      const response = { mode, maintenance_message: row.maintenance_message || null };

      // Private-mode code verification happens here, server-side — the
      // real code is never sent to the browser or to middleware.js.
      // A ?code= query param is checked against it and only a boolean
      // comes back.
      if (mode === "private") {
        const submitted = req.query?.code;
        response.access_granted = Boolean(
          submitted && row.private_access_code && submitted === row.private_access_code
        );
      }

      return res.status(200).json(response);
    } catch (err) {
      // Same reasoning as the missing-env-var case above: if Supabase is
      // briefly unreachable, don't take the whole site down with it.
      return res.status(200).json({ mode: "live", maintenance_message: null });
    }
  }

  if (req.method === "POST") {
    const providedSecret = req.headers["x-admin-secret"];
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { mode, private_access_code, maintenance_message } = req.body || {};
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
    }

    const patch = { mode, updated_at: new Date().toISOString() };
    if (private_access_code !== undefined) patch.private_access_code = private_access_code;
    if (maintenance_message !== undefined) patch.maintenance_message = maintenance_message;

    try {
      await supabaseFetch("site_settings?id=eq.1", {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      return res.status(200).json({ ok: true, mode });
    } catch (err) {
      return res.status(500).json({ error: "failed to update site_settings", detail: String(err) });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
