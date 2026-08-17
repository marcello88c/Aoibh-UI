// POST /api/match-designer
// Body: { answers: { project, budget, deadline, assets }, email, name }
// Returns: { designer: { id, name, title, experience, location, img }, reason, confidence, source }
//
// Called ONCE per completed brief, right after the summary card renders.
// Picks the best-fit profile from the same 6 real, photographed designers
// shown on the Studio gallery (below) and has Claude write a one-line
// reason tying the pick to specifics from the brief, plus a 0-100
// confidence score. The frontend only shows a designer card when
// confidence is 80+; below that it hands off to a human producer instead.
// If the API call fails, times out, or returns something malformed, we
// fall back to a simple keyword-matching heuristic over the same roster --
// so a designer card (or a clean human hand-off) always renders, brief or
// no brief AI.
//
// Every completed brief (AI-matched or fallback-matched) is saved to
// Supabase's briefs table via saveBrief(), and a notification email is
// sent via Resend if RESEND_API_KEY is configured.

// Roster deliberately matches the 6 real, photographed designers shown on
// the main site's Studio gallery (index.html #gallery) -- not a separate
// fictional list. Putting a real person's photo under a made-up identity
// would be worse than no photo at all, so this roster and the gallery are
// kept as the same 6 people, on purpose.
const ROSTER = [
  {
    id: "eve-berlin",
    name: "Eve",
    title: "Brand Identity Designer",
    experience: "9 years",
    location: "Berlin, DE",
    img: "assets/designers/eve_berlin.jpeg",
    tags: ["branding", "identity", "logo", "startup", "rebrand", "naming"],
  },
  {
    id: "zac-sf",
    name: "Zac",
    title: "Product & UX Designer",
    experience: "7 years",
    location: "San Francisco, US",
    img: "assets/designers/zac_melbourne.jpg",
    tags: ["ux", "ui", "product", "app", "saas", "web app", "dashboard"],
  },
  {
    id: "nicole-paris",
    name: "Nicole",
    title: "Web & Editorial Designer",
    experience: "10 years",
    location: "Paris, FR",
    img: "assets/designers/nicole_paris.jpeg",
    tags: ["website", "web design", "landing page", "editorial", "marketing site", "layout"],
  },
  {
    id: "gemma-melbourne",
    name: "Gemma",
    title: "Motion & Video Designer",
    experience: "6 years",
    location: "Melbourne, AU",
    img: "assets/designers/gemma_melbourne.jpeg",
    tags: ["motion", "video", "animation", "reel", "social video", "trailer"],
  },
  {
    id: "marc-belfast",
    name: "Marc",
    title: "Packaging & Print Designer",
    experience: "11 years",
    location: "Belfast, UK",
    img: "assets/designers/marc_belfast.jpeg",
    tags: ["packaging", "print", "label", "product design", "retail"],
  },
  {
    id: "naomi-copenhagen",
    name: "Naomi",
    title: "Illustration & Social Content Designer",
    experience: "5 years",
    location: "Copenhagen, DK",
    img: "assets/designers/naomi_copenhagen.jpeg",
    tags: ["illustration", "social media", "content", "campaign", "instagram", "character"],
  },
];

function briefText(answers) {
  return Object.values(answers || {}).filter(Boolean).join(" ").toLowerCase();
}

async function saveBrief(opts) {
  var email = opts.email;
  var name = opts.name;
  var answers = opts.answers;
  var result = opts.result;

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await
