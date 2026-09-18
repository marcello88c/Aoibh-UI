// POST /api/upload-deliverable
// Body (multipart/form-data): briefId, file, kind ('deliverable' | 'preview'),
// label (preview only — e.g. "Homepage")
//
// kind=deliverable (default): uploads to Supabase Storage's "deliverables"
// bucket and creates a row in the `deliverables` table — the final,
// full-resolution files a client sees once fully paid.
//
// kind=preview: uploads to the same bucket under a previews/ prefix and
// appends { label, url } to the brief's `preview_urls` jsonb array
// instead — the reduced-quality proofs shown in dashboard.html's
// in-progress state, before the balance is paid. Requires the brief's
// `preview_urls` column to exist — see
// Research/backend-architecture-proposal.md section 0 for the migration
// SQL if it hasn't been run yet.
//
// Requires a valid aoibh_staff_session cookie (see api/auth-session.js) —
// real staff auth, replacing the old shared x-admin-secret gate.

export const config = {
  api: {
    bodyParser: false,
  },
};

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

// Supabase Storage rejects some characters in object keys outright (e.g.
// the "…" macOS uses to truncate long filenames), and publicUrl below
// interpolates the filename raw rather than URL-encoding it — so a stray
// character there doesn't just look ugly, it 400s the whole upload.
// Strip to a safe, boring charset instead of trying to allow-list every
// character both Supabase and a raw URL are happy with.
function sanitizeFilename(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const cleanBase = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const cleanExt = ext.replace(/[^a-zA-Z0-9.]+/g, "");
  return (cleanBase || "file") + cleanExt;
}

// Lightweight AI quality check — compares an uploaded image against the
// client's original brief text (not structured brand_specs; deliberately
// skipped for v1, see Research/backend-architecture-proposal.md section 0).
// Only flags genuine mismatches (wrong deliverable type, blank/broken file,
// content unrelated to the brief) — never subjective craft/taste calls,
// which stay a human decision. Fails soft: any error here just skips QA,
// never blocks the actual upload.
async function runQaCheck({ answers, fileUrl }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const briefSummary = Object.entries(answers || {})
      .map(([k, v]) => `${k}: ${v || "—"}`)
      .join("\n");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system: `You are doing a quick, lightweight quality check on a design
file a freelance designer just submitted for a client's project, comparing
it against what the client originally asked for. You are NOT critiquing
craft, taste, or subjective creative choices — a human reviewer makes the
real creative call. Only flag a genuine mismatch or problem: the wrong
type of deliverable entirely (e.g. the brief asked for a logo but this is
a webpage), an apparently blank/broken/placeholder file, or content
clearly unrelated to the brief. When in doubt, don't flag it — err toward
"none".

Respond ONLY with JSON, no prose, no markdown fences, in this exact shape:
{"issueType":"off_brief"|"quality_concern"|"none","confidence":<integer 0-100>,"detail":"<one sentence, under 25 words>"}`,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: fileUrl } },
              { type: "text", text: `Brief answers:\n${briefSummary}\n\nCheck this file against the brief now.` },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) {
      console.error("runQaCheck API error:", r.status, await r.text());
      return null;
    }

    const data = await r.json();
    const raw = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(raw);

    if (!["off_brief", "quality_concern", "none"].includes(parsed.issueType)) return null;
    if (typeof parsed.confidence !== "number" || Number.isNaN(parsed.confidence)) return null;

    return {
      issueType: parsed.issueType,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))),
      detail: typeof parsed.detail === "string" ? parsed.detail.trim() : "",
    };
  } catch (err) {
    console.error("runQaCheck failed:", err.message);
    return null;
  }
}

async function saveQaCheck({ briefId, kind, fileUrl, fileName, result }) {
  if (!result) return;
  try {
    const status = result.issueType === "none" ? "cleared_by_ai" : "flagged";
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/qa_checks`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        brief_id: briefId,
        kind,
        file_url: fileUrl,
        file_name: fileName,
        issue_type: result.issueType,
        confidence: result.confidence,
        detail: result.detail,
        status,
      }),
    });
    if (!res.ok) {
      console.error("saveQaCheck error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("saveQaCheck failed:", err.message);
  }
}

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

async function readMultipart(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) throw new Error("No multipart boundary found");
  const boundary = "--" + boundaryMatch[1];

  const parts = buffer.toString("binary").split(boundary).slice(1, -1);
  const fields = {};
  let file = null;

  for (const part of parts) {
    const [rawHeaders, ...rest] = part.split("\r\n\r\n");
    const body = rest.join("\r\n\r\n").slice(0, -2); // trim trailing \r\n
    const nameMatch = rawHeaders.match(/name="([^"]+)"/);
    const filenameMatch = rawHeaders.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;

    if (filenameMatch) {
      const fileTypeMatch = rawHeaders.match(/Content-Type:\s*(.+)/i);
      file = {
        fieldName: nameMatch[1],
        filename: filenameMatch[1],
        contentType: fileTypeMatch ? fileTypeMatch[1].trim() : "application/octet-stream",
        buffer: Buffer.from(body, "binary"),
      };
    } else {
      fields[nameMatch[1]] = body.trim();
    }
  }

  return { fields, file };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const staffEmail = await requireStaffSession(req);
  if (!staffEmail) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { fields, file } = await readMultipart(req);
    const briefId = (fields.briefId || "").trim();
    const kind = (fields.kind || "deliverable").trim();
    const label = (fields.label || "").trim();

    if (!briefId) {
      return res.status(400).json({ error: "Missing briefId" });
    }
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (kind === "preview" && !label) {
      return res.status(400).json({ error: "Missing label for preview image" });
    }

    const storagePrefix = kind === "preview" ? `previews/${briefId}` : briefId;
    const storagePath = `${storagePrefix}/${Date.now()}-${sanitizeFilename(file.filename)}`;

    const uploadRes = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/deliverables/${encodeURIComponent(storagePath)}`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": file.contentType,
        },
        body: file.buffer,
      }
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.error("upload-deliverable storage error:", uploadRes.status, text);
      return res.status(502).json({ error: "Failed to upload file to storage" });
    }

    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/deliverables/${storagePath}`;

    if (kind === "preview") {
      // Append to the brief's preview_urls array rather than the
      // deliverables table — previews are proofs shown pre-balance-payment,
      // not the final files.
      const briefRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}&select=preview_urls,email,name,answers`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        }
      );
      if (!briefRes.ok) {
        console.error("upload-deliverable brief fetch error:", briefRes.status, await briefRes.text());
        return res.status(502).json({ error: "File uploaded but failed to find project" });
      }
      const briefRows = await briefRes.json();
      if (!briefRows[0]) {
        return res.status(404).json({ error: "File uploaded but project not found" });
      }
      const existingPreviews = Array.isArray(briefRows[0].preview_urls) ? briefRows[0].preview_urls : [];
      const updatedPreviews = [...existingPreviews, { label, url: publicUrl }];

      const patchRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}`, {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ preview_urls: updatedPreviews }),
      });

      if (!patchRes.ok) {
        const text = await patchRes.text();
        console.error("upload-deliverable preview_urls update error:", patchRes.status, text);
        return res.status(502).json({ error: "File uploaded but failed to save preview" });
      }

      // Only notify on the first preview of a round — a producer adding
      // several screens for the same review shouldn't fire one email per
      // image, just one "it's ready to look at" per round.
      if (existingPreviews.length === 0) {
        const brief = briefRows[0];
        const dashboardUrl = `${process.env.SITE_URL}/dashboard.html?id=${briefId}&email=${encodeURIComponent(brief.email || "")}`;
        await sendClientEmail({
          to: brief.email,
          subject: "Your preview is ready to review",
          text: `Hi ${brief.name || "there"},\n\nYour project's first preview is up — take a look and let us know what you think.\n\nView it here: ${dashboardUrl}\n\n— Aoibh`,
        });
      }

      let qaResult = null;
      if (file.contentType.startsWith("image/")) {
        qaResult = await runQaCheck({ answers: briefRows[0].answers, fileUrl: publicUrl });
        await saveQaCheck({ briefId, kind: "preview", fileUrl: publicUrl, fileName: file.filename, result: qaResult });
      }

      return res.status(200).json({ ok: true, fileUrl: publicUrl, qa: qaResult });
    }

    const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/deliverables`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        brief_id: briefId,
        file_name: file.filename,
        file_url: publicUrl,
        file_size: file.buffer.length,
      }),
    });

    if (!insertRes.ok) {
      const text = await insertRes.text();
      console.error("upload-deliverable db insert error:", insertRes.status, text);
      return res.status(502).json({ error: "File uploaded but failed to save record" });
    }

    let qaResult = null;
    if (file.contentType.startsWith("image/")) {
      try {
        const briefRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}&select=answers`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
            },
          }
        );
        if (briefRes.ok) {
          const briefRows = await briefRes.json();
          if (briefRows[0]) {
            qaResult = await runQaCheck({ answers: briefRows[0].answers, fileUrl: publicUrl });
            await saveQaCheck({ briefId, kind: "deliverable", fileUrl: publicUrl, fileName: file.filename, result: qaResult });
          }
        }
      } catch (err) {
        // QA is a nice-to-have on top of an already-saved deliverable —
        // never let a lookup failure here undo a successful upload.
        console.error("deliverable QA lookup failed:", err.message);
      }
    }

    return res.status(200).json({ ok: true, fileUrl: publicUrl, qa: qaResult });
  } catch (err) {
    console.error("upload-deliverable failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
