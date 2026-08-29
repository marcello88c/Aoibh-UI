// POST /api/upload-deliverable
// Body (multipart/form-data): briefId, file
// Uploads the file to Supabase Storage's "deliverables" bucket, then
// creates a matching row in the `deliverables` table pointing to it.
//
// NOTE — no auth: this endpoint has no login check. It's meant for
// internal use only (you, the producer) — not exposed as a public-facing
// feature yet. Don't share the upload.html link outside the studio.

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

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    const { fields, file } = await readMultipart(req);
    const briefId = (fields.briefId || "").trim();

    if (!briefId) {
      return res.status(400).json({ error: "Missing briefId" });
    }
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const storagePath = `${briefId}/${Date.now()}-${file.filename}`;

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
