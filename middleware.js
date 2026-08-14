// middleware.js — Vercel Edge Middleware, runs before every request.
// See Research/backend-architecture-proposal.md section 8.
//
// No external dependencies on purpose — this project has no package.json
// yet, and the Edge Runtime's built-in Request/Response/fetch/URL cover
// everything this needs without adding one.

export const config = {
  // Runs on every path except: the API routes themselves (site-mode has
  // to always be reachable, or the gate could never be checked or
  // lifted), static assets, and the maintenance page itself (to avoid
  // redirecting it to itself in a loop).
  matcher: ["/((?!api/|assets/|maintenance\\.html|favicon).*)"],
};

const PRIVATE_COOKIE = "aoibh_private_access";

export default async function middleware(request) {
  const url = new URL(request.url);

  let mode = "live";
  let accessGranted = false;

  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const alreadyHasAccess = cookieHeader.includes(`${PRIVATE_COOKIE}=granted`);
    const submittedCode = url.searchParams.get("code");

    const modeUrl = new URL("/api/site-mode", url.origin);
    if (submittedCode) modeUrl.searchParams.set("code", submittedCode);

    const apiRes = await fetch(modeUrl.toString());
    const data = await apiRes.json();
    mode = data.mode || "live";
    accessGranted = alreadyHasAccess || Boolean(data.access_granted);
  } catch (err) {
    // Same fail-open reasoning as site-mode.js itself — if this check
    // can't complete for any reason, don't take the whole site down
    // with it. Worse to accidentally lock everyone out during a real
    // outage than to occasionally skip a gate.
    return;
  }

  if (mode === "maintenance") {
    const page = await fetch(new URL("/maintenance.html", url.origin));
    return new Response(await page.text(), {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (mode === "private" && accessGranted) {
    // Valid code just submitted via ?code= — set the cookie and redirect
    // to the clean URL so it isn't re-checked on every request, and the
    // code doesn't linger visibly in the address bar or browser history.
    if (url.searchParams.get("code")) {
      const clean = new URL(url);
      clean.searchParams.delete("code");
      // Response.redirect() returns an immutable Response — can't add
      // headers to it afterward. Build the redirect manually instead so
      // the Set-Cookie header can actually be attached.
      return new Response(null, {
        status: 302,
        headers: {
          Location: clean.toString(),
          "Set-Cookie": `${PRIVATE_COOKIE}=granted; Path=/; Max-Age=2592000; SameSite=Lax`,
        },
      });
    }
    return; // already had the cookie — pass through normally
  }

  if (mode === "private" && !accessGranted) {
    return new Response(privateGateHtml(url.searchParams.has("code")), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // 'live' and 'beta' modes: pass through untouched.
  return;
}

function privateGateHtml(showError) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Private access — Aoibh</title>
<meta name="robots" content="noindex, nofollow">
<style>
  body{ font-family: -apple-system, sans-serif; background:#F2F4F5; display:flex;
        align-items:center; justify-content:center; height:100vh; margin:0; }
  form{ background:#fff; padding:40px; border-radius:10px; text-align:center;
        box-shadow:0 20px 50px rgba(0,0,0,.08); }
  h1{ font-size:18px; margin:0 0 8px; color:#293239; }
  p{ color:#55575C; font-size:13px; margin:0 0 20px; }
  input{ padding:10px 14px; border:1px solid #C6CBD2; border-radius:6px; font-size:14px; }
  button{ padding:10px 18px; margin-left:8px; border-radius:6px; border:none;
          background:#293239; color:#fff; cursor:pointer; }
  .error{ color:#D64545; font-size:12px; margin-top:12px; }
</style>
</head>
<body>
  <form method="GET" action="">
    <h1>Aoibh — private access</h1>
    <p>This site is currently in private preview.</p>
    <input type="text" name="code" placeholder="Access code" autofocus>
    <button type="submit">Enter</button>
    ${showError ? '<div class="error">That code didn\'t work — try again.</div>' : ""}
  </form>
</body>
</html>`;
}
