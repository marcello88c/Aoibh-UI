// GET /api/job-status?jobNumber=<n>&email=<email>
// Powers the triage flow's "I have a job number for a progress report"
// branch with a real status instead of a canned "let me check" message.
//
// Requires `email` to match the brief's stored email — the same interim
// security pattern as dashboard-data.js, and arguably more important
// here: job_number is a short, sequential integer (easy to guess/
// enumerate), unlike the brief's UUID id. See dashboard-data.js's header
// comment for the fuller reasoning; this is a stopgap until real client
// auth exists (migration phase 11), not a permanent answer.
//
// Returns a short status summary, not the full brief — the dashboard
// link is what shows everything else.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const jobNumber = (req.query && req.query.jobNumber || "").trim();
  const email = (req.query && req.query.email || "").trim().toLowerCase();

  if (!jobNumber || !/^\d+$/.test(jobNumber)) {
    return res.status(400).json({ error: "Missing or invalid jobNumber" });
  }
  if (!email) {
    return res.status(400).json({ error: "Missing required query param: email" });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    const supaRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/briefs?job_number=eq.${encodeURIComponent(jobNumber)}&select=id,email,answers,status,payment_status,preview_urls,deliverables(id)`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      }
    );

    if (!supaRes.ok) {
      console.error("job-status supabase error:", supaRes.status, await supaRes.text());
      return res.status(502).json({ error: "Failed to look up project" });
    }

    const rows = await supaRes.json();
    const brief = rows[0];

    if (!brief || (brief.email || "").trim().toLowerCase() !== email) {
      // Same response either way — don't reveal whether the job number
      // exists to a caller who doesn't already know the right email.
      return res.status(404).json({ error: "No project found with that job number and email" });
    }

    const isDelivered = brief.status === "delivered" && Array.isArray(brief.deliverables) && brief.deliverables.length > 0;
    const hasPreview = Array.isArray(brief.preview_urls) && brief.preview_urls.length > 0;

    let statusLine;
    if (isDelivered) {
      statusLine = "Delivered — your files are ready to download.";
    } else if (brief.payment_status === "paid_in_full") {
      statusLine = "Payment received — we're finalizing your files.";
    } else if (brief.payment_status === "deposit_paid" && hasPreview) {
      statusLine = "In progress — your preview is ready to review.";
    } else if (brief.payment_status === "deposit_paid") {
      statusLine = "In progress — your designer is working on it.";
    } else {
      statusLine = "Waiting on your deposit to begin work.";
    }

    return res.status(200).json({
      jobNumber,
      project: (brief.answers && brief.answers.project) || "your project",
      statusLine,
      dashboardUrl: `${process.env.SITE_URL}/dashboard.html?id=${brief.id}&email=${encodeURIComponent(brief.email)}`,
    });
  } catch (err) {
    console.error("job-status failed:", err.message);
    return res.status(500).json({ error: "Unexpected error" });
  }
}
