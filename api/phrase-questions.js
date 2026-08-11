// POST /api/phrase-questions
// Body: {} (no input needed — this just asks Claude to phrase the fixed
// question set in a warm, natural voice). Returns:
//   { questions: [ { key, text }, ... ] }
//
// This is called ONCE per brief session, when the modal opens — not once
// per question — so it's a single API call per visitor who starts a brief.
// If it fails or times out, the frontend falls back to static copy, so a
// user can always complete a brief even if this endpoint is down.
//
// Note: this only phrases the four intake questions that follow the triage
// step. The triage question itself ("Is this your first enquiry, or do you
// have a job number...") is hardcoded on the frontend, not phrased here —
// its exact wording matters for the job-number-vs-first-enquiry branch, so
// it isn't left to the model to reword.

const QUESTION_KEYS = ["project", "budget", "deadline", "assets"];

const FALLBACK_QUESTIONS = [
  { key: "project", text: "What type of project are you interested in?" },
  { key: "budget", text: "Great — what's the budget range for this project?" },
  { key: "deadline", text: "And what's your timeline — when would you need this delivered?" },
  { key: "assets", text: "Last one — will you be supplying assets like a logo, brand guides, or videos, or will we be creating everything as new?" },
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Misconfigured deploy — fail soft with the static copy rather than 500ing.
    return res.status(200).json({ questions: FALLBACK_QUESTIONS, source: "fallback" });
  }

  const systemPrompt = `You write the follow-up questions for a creative
studio's intake chat widget (Aoibh — an AI + human creative production
studio). The visitor has already confirmed this is a first enquiry (a prior,
separate question handled that). Rephrase these four fixed questions in a
warm, concise, professional voice. Keep each under 20 words. Do not add a
greeting, do not add extra questions, do not merge questions, do not change
their order or meaning.

Questions to rephrase, in order:
1. project — what type of project are they interested in
2. budget — what is the budget range for this project
3. deadline — what is their timeline / when do they need it delivered
4. assets — will they be supplying existing assets (logo, brand guides, videos) or does everything need creating from scratch

Respond ONLY with JSON, no prose, no markdown fences, in this exact shape:
{"questions":[{"key":"project","text":"..."},{"key":"budget","text":"..."},{"key":"deadline","text":"..."},{"key":"assets","text":"..."}]}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: "Generate the four phrasings now." }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) throw new Error(`Anthropic API error: ${r.status}`);

    const data = await r.json();
    const raw = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(raw);

    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const valid =
      questions.length === QUESTION_KEYS.length &&
      QUESTION_KEYS.every((k, i) => questions[i]?.key === k && typeof questions[i]?.text === "string");

    if (!valid) throw new Error("Malformed question set from model");

    return res.status(200).json({ questions, source: "ai" });
  } catch (err) {
    // Network error, timeout, bad JSON, or malformed shape — always fail soft.
    console.error("phrase-questions failed:", err.message);
    return res.status(200).json({ questions: FALLBACK_QUESTIONS, source: "fallback" });
  }
}
