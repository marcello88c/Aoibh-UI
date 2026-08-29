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
