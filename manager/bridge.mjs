import { isIP } from "node:net";
const reply = (message, status) =>
  Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
export async function bridge(request, config = process.env, fetcher = fetch) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint");
  const rewritten = (["/api", "/api/index"].includes(url.pathname) || url.pathname === `/api/${endpoint}`) && url.searchParams.getAll('endpoint').length === 1 && ["auth", "club", "public", "ratings-sync"].includes(endpoint);
  const path = rewritten ? `/api/${endpoint}` : url.pathname;
  const isPublic=path==='/api/public';
  const isSync=path==='/api/ratings-sync';
  const parameters=[...url.searchParams].filter(([key])=>!(rewritten&&key==='endpoint'));
  const event=url.searchParams.get('event');
  const validPublic=parameters.length===0||(parameters.length===1&&parameters[0][0]==='event'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event??''));
  if (!["/api/auth", "/api/club", "/api/public", "/api/ratings-sync"].includes(path) || (isPublic?!validPublic:parameters.length!==0))
    return reply("Not found.", 404);
  if(isPublic&&request.method!=='GET')return Response.json({error:'This view is read-only.'},{status:405,headers:{Allow:'GET','Cache-Control':'no-store'}});
  if (!["GET", "POST"].includes(request.method))
    return reply("Method not allowed.", 405);
  const syncAuthorization=request.headers.get('authorization');
  if(isSync&&!/^Bearer [a-f0-9]{64}$/.test(syncAuthorization??''))return reply('Sync access required.',401);
  if (request.method === "POST" && !isSync && request.headers.get("origin") !== url.origin)
    return reply("Cross-origin request rejected.", 403);
  if (
    request.method === "POST" &&
    request.headers.get("content-type")?.split(';')[0].trim().toLowerCase() !== "application/json"
  )
    return reply("JSON required.", 415);
  if (
    !config.CLUB_BACKEND_URL ||
    !config.CLUB_BACKEND_TOKEN ||
    !config.CLUB_PROXY_KEY
  )
    return reply("Service is not configured.", 503);
  // Upstream destination is server configuration, never input from a visitor.
  const backend = new URL(config.CLUB_BACKEND_URL);
  if (
    backend.protocol !== "https:" ||
    backend.username ||
    backend.password ||
    backend.pathname !== "/" ||
    backend.search ||
    backend.hash
  )
    return reply("Service is not configured.", 503);
  const headers = new Headers({
    "OAI-Sites-Authorization": `Bearer ${config.CLUB_BACKEND_TOKEN}`,
    "x-boardroom-proxy-key": config.CLUB_PROXY_KEY,
  });
  if(isSync)headers.set('authorization',syncAuthorization);
  // Vercel sets this trusted header; do not trust ordinary x-forwarded-for.
  const clientIP = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (clientIP && isIP(clientIP))
    headers.set("x-boardroom-client-ip", clientIP);
  const session = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("__Host-boardroom_session="))
    .join("; ");
  if (session && !isPublic && !isSync) headers.set("cookie", session);
  const setupKey = request.headers.get("x-boardroom-setup-key");
  if (
    path === "/api/auth" &&
    setupKey &&
    /^[a-f0-9]{64}$/.test(setupKey)
  )
    headers.set("x-boardroom-setup-key", setupKey);
  let body;
  if (request.method === "POST") {
    const max = path === "/api/auth" ? 4096 : isSync?1024:64000;
    if (Number(request.headers.get("content-length")) > max)
      return reply("Request too large.", 413);
    const reader = request.body?.getReader();
    const parts = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > max) {
          await reader.cancel();
          return reply("Request too large.", 413);
        }
        parts.push(chunk.value);
      }
    }
    body = Buffer.concat(parts);
    headers.set("content-type", "application/json");
    headers.set("origin", backend.origin);
  }
  try {
    const destination=new URL(path,backend);if(isPublic&&event)destination.searchParams.set('event',event);
    const upstream = await fetcher(destination, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    // Do not forward platform login redirects, HTML, identity, or platform cookies.
    if (
      (upstream.status >= 300 && upstream.status < 400) ||
      !upstream.headers.get("content-type")?.includes("application/json")
    )
      return reply("Account service unavailable.", 502);
    const outputHeaders = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if(isPublic||isSync)outputHeaders.set('X-Robots-Tag','noindex, nofollow');
    const retryAfter=upstream.headers.get('retry-after');
    if(upstream.status===429&&retryAfter&&/^\d{1,5}$/.test(retryAfter))outputHeaders.set('Retry-After',retryAfter);
    for (const cookie of (isPublic||isSync)?[]:upstream.headers.getSetCookie())
      if (
        cookie.startsWith("__Host-boardroom_session=") &&
        !/;\s*domain=/i.test(cookie)
      )
        outputHeaders.append("set-cookie", cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outputHeaders,
    });
  } catch {
    console.error("Club backend request failed.");
    return reply("Could not connect. Try again.", 502);
  }
}
