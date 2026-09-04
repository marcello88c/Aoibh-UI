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
// Requires an `x-admin-secret` header matching SITE_MODE_ADMIN_SECRET —
// the same interim admin gate api/site-mode.js already uses (see its
// header comment, and Research/backend-architecture-proposal.md section
// 8's open questions for why this is deliberately a stopgap rather than
// real staff auth). Reused here rather than adding a second secret, since
// both are "you, the one operator" gates until migration phase 7 (staff
// auth) exists.

export const config = {
  api: {
    bodyParser: false,
  },
};

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

  const providedSecret = req.headers["x-admin-secret"];
  const ADMIN_SECRET = process.env.SITE_MODE_ADMIN_SECRET;
  if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
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
    const storagePath = `${storagePrefix}/${Date.now()}-${file.filename}`;

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
        `${process.env.SUPABASE_URL}/rest/v1/briefs?id=eq.${encodeURIComponent(briefId)}&select=preview_urls`,
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

      return res.status(200).json({ ok: true, fileUrl: publicUrl });
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

    return res.status(200).json({ ok: true, fileUrl: publicUrl });
  } catch (err) {
    console.error("upload-deliverable failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
